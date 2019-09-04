sap.ui.define([
    "com/ui5/testing/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    'sap/m/MessagePopover',
    'sap/m/MessageItem',
    "com/ui5/testing/model/Navigation",
    "com/ui5/testing/model/Communication",
    "com/ui5/testing/model/RecordController",
    "com/ui5/testing/model/GlobalSettings",
    "com/ui5/testing/model/CodeHelper",
    "com/ui5/testing/model/ChromeStorage",
    "com/ui5/testing/model/Utils",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Text",
    "com/ui5/testing/libs/jszip.min",
    "com/ui5/testing/libs/FileSaver.min"
], function (Controller,
    JSONModel,
    MessagePopover,
    MessageItem,
    Navigation,
    Communication,
    RecordController,
    GlobalSettings,
    CodeHelper,
    ChromeStorage,
    Utils,
    MessageToast,
    Dialog,
    Button,
    Text) {
    "use strict";

    return Controller.extend("com.ui5.testing.controller.testDetails", {
        utils: Utils,
        _oModel: new JSONModel({
            codes: [],
            test: {},
            replayMode: false,
            replayType: 0,
            routeName: "",
            codeSettings: {
                language: "UI5",
                testName: "",
                testCategory: "",
                testUrl: "",
                ui5Version: "",
                supportAssistant: false
            },
            dynamic: {
                attrType: []
            },
            statics: {
                supportRules: []
            },
            activeTab: 'settings'
        }),
        _bActive: false,
        _iGlobal: 0,
        _bStarted: false,
        _bReplayMode: false,

        /**
         *
         */
        onInit: function () {
            Communication.registerEvent("itemSelected", this._onItemSelected.bind(this));

            this.getView().setModel(this._oModel, "viewModel");
            this.getView().setModel(RecordController.getModel(), "recordModel");
            this.getView().setModel(Navigation.getModel(), "navModel");
            this.getView().setModel(GlobalSettings.getModel(), "settings");
            this._createDialog();
            this.getOwnerComponent().getRouter().getRoute("testDetails").attachPatternMatched(this._onTestDisplay, this);
            this.getOwnerComponent().getRouter().getRoute("testDetailsCreate").attachPatternMatched(this._onTestCreate, this);
            this.getOwnerComponent().getRouter().getRoute("testDetailsCreateQuick").attachPatternMatched(this._onTestCreateQuick, this);
            this.getOwnerComponent().getRouter().getRoute("testReplay").attachPatternMatched(this._onTestReplay, this);
            Communication.registerEvent("loaded", this._onInjectionDone.bind(this));

            //Why is this function subscribed?
            //sap.ui.getCore().getEventBus().subscribe("RecordController", "windowFocusLost", this._recordStopped, this);
        },

        _onInjectionDone: function (oData) {
            if (oData.ok === true) {
                this._oModel.setProperty('/ui5Version', oData.version);
            }
        },

        _replay: function () {
            var sUrl = this._oModel.getProperty("/codeSettings/testUrl");
            chrome.tabs.create({
                url: sUrl,
                active: true
            }, function (tab) {
                var sCheckUrl = sUrl;
                var bInjectRequested = false;
                /**
                 *
                 * @param {*} tabId
                 * @param {*} changeInfo
                 * @param {*} tab
                 */
                const fnListenerFunction = function (tabId, changeInfo, tab) {
                    if (tab.url.indexOf(sCheckUrl) > -1 && changeInfo.status === 'complete' && !bInjectRequested) {
                        /*                     chrome.windows.create({
                                                tabId: tab.id,
                                                type: 'normal',
                                                focused: true
                                                //state: 'maximized'
                                            }, function (fnWindow) {
                                                //now inject into our window..
                         */
                        RecordController.injectScript(tab.id).then(function (oData) {
                            //check here
                            if (RecordController.isInjected() && !this._bReplayMode) {
                                this._bReplayMode = true;
                                this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                                    oStep.setHighlight(sap.ui.core.MessageType.None);
                                });
                                this._startReplay();
                            }
                            if (oData) {
                                this._oModel.setProperty('/ui5Version', oData.version);
                            }
                        }.bind(this));
                        bInjectRequested = true;
                        /*
                        const fnListenHandshake = function (message, sender, sendResponse) {
                            if (message.type === "HandshakeToWindow") {
                                chrome.runtime.sendMessage({
                                    "type": "send-window-id",
                                }, function (response) {});
                                chrome.runtime.onMessage.removeListener(fnListenerFunction());
                            }
                        };

                        chrome.runtime.onMessage.addListener(fnListenHandshake());*/
                        //}.bind(this));
                        chrome.tabs.onUpdated.removeListener(fnListenerFunction.bind(this));
                    }
                };

                chrome.tabs.onUpdated.addListener(fnListenerFunction.bind(this));
            }.bind(this));
        },

        _startReplay: function () {
            this._iCurrentStep = 0;
            this._updatePlayButton();
        },

        onReplaySingleStep: function (oEvent) {
            //var oLine = oEvent.getSource().getParent();
            RecordController.focusTargetWindow();
            var oLine = this.getView().byId('tblPerformedSteps').getItems()[this._iCurrentStep];
            this._executeAction().then(function (oResult) {
                var performedStep = oLine;
                //this is our custom object
                if (oResult && oResult.type && oResult.type === "ASS") {
                    switch (oResult.result) {
                        case "success":
                            performedStep.setHighlight(sap.ui.core.MessageType.Success);
                            this.replayNextStep();
                            break;
                        case "warning":
                            performedStep.setHighlight(sap.ui.core.MessageType.Warning);
                            this.replayNextStep();
                            break;
                        case "error":
                            this.getModel("viewModel").setProperty("/replayMode", false);
                            MessageToast.show('Assertion not met, check your setup!');
                            performedStep.setHighlight(sap.ui.core.MessageType.Error);
                            this._bReplayMode = false;
                            this.getModel("viewModel").setProperty("/replayMode", false);
                            RecordController.stopRecording();
                            this.getRouter().navTo("testDetails", {
                                TestId: this.getModel("navModel").getProperty("/test/uuid")
                            });
                            break;
                        default:
                            jQuery.sap.log.info(`No handling for no event`);
                    }
                    //This is the object back from the Communication object.
                } else if (oResult && oResult.uuid) {
                    if (oResult.processed) {
                        performedStep.setHighlight(sap.ui.core.MessageType.Success);
                        this.replayNextStep();
                    } else {
                        this.getModel("viewModel").setProperty("/replayMode", false);
                        MessageToast.show('Action can not be performed, check your setup!');
                        performedStep.setHighlight(sap.ui.core.MessageType.Error);
                    }
                } else if (oResult && oResult.type && oResult.type === "ACT" && oResult.result === "error") {
                    this.getModel("viewModel").setProperty("/replayMode", false);
                    MessageToast.show('Action can not be performed, check your setup!');
                    performedStep.setHighlight(sap.ui.core.MessageType.Error);
                }
            }.bind(this));
        },

        _executeAction: function () {
            var aEvent = this.getModel("navModel").getProperty("/elements");
            var oElement = aEvent[this._iCurrentStep];

            return new Promise(function (resolve) {
                if (oElement && oElement.property.type === "ACT") {
                    this._getFoundElements(oElement).then(function (aElements) {
                        if (aElements.length === 0) {
                            resolve({
                                result: "error",
                                type: "ACT"
                            });
                            return;
                        }
                        oElement.item.identifier = aElements[0].identifier;
                        Communication.fireEvent("execute", {
                            element: oElement
                        }).then(resolve);
                    });
                } else if (oElement && oElement.property.type === "ASS") {
                    this._getFoundElements(oElement).then(function (aElements) {
                        if (aElements.length === 1) {
                            resolve({
                                result: "success",
                                type: "ASS"
                            });
                        } else if (aElements.length > 1) {
                            resolve({
                                result: "warning",
                                type: "ASS"
                            });
                        } else {
                            resolve({
                                result: "error",
                                type: "ASS"
                            });
                        }
                    });
                } else {
                    resolve();
                    return false;
                }
            }.bind(this));
        },

        _getFoundElements: function (oElement) {
            var oDefinition = oElement.selector;

            return new Promise(function (resolve, reject) {
                this._findItemAndExclude(oDefinition.selectorAttributes).then(function (aItemsEnhanced) {
                    //make an assert check..
                    resolve(aItemsEnhanced);
                });
            }.bind(this));
        },

        _findItemAndExclude: function (oSelector) {
            return Communication.fireEvent("find", oSelector);
        },

        replayNextStep: function () {
            var aEvent = this.getModel("navModel").getProperty("/elements");
            this._iCurrentStep += 1;
            this._updatePlayButton();
            if (this._iCurrentStep >= aEvent.length) {
                this._bReplayMode = false;
                this.getModel("viewModel").setProperty("/replayMode", false);
                RecordController.stopRecording();
                //RecordController.startRecording();
                this.checkRecordContinuing();
                this.getRouter().navTo("testDetails", {
                    TestId: this.getModel("navModel").getProperty("/test/uuid")
                });
            }
        },

        checkRecordContinuing: function () {
            var dialog = new Dialog({
                title: 'Start Recording?',
                type: 'Message',
                content: new Text({
                    text: 'Do you want to add additional test steps?'
                }),
                beginButton: new Button({
                    text: 'Yes',
                    tooltip: 'Starts the recording process',
                    press: function () {
                        RecordController.startRecording();
                        this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                            oStep.setHighlight(sap.ui.core.MessageType.None);
                        });
                        dialog.close();
                    }.bind(this)
                }),
                endButton: new Button({
                    text: 'No',
                    tooltip: 'No further actions',
                    // eslint-disable-next-line require-jsdoc
                    press: function () {
                        dialog.close();
                    }
                }),
                // eslint-disable-next-line require-jsdoc
                afterClose: function () {
                    dialog.destroy();
                }
            });

            dialog.open();
        },

        _updatePlayButton: function () {
            if (!this._oModel.getProperty("/replayMode")) {
                this._oModel.setProperty("/replayMode", true);
            }
            var aElement = this.getModel("navModel").getProperty("/elements");
            for (var i = 0; i < aElement.length; i++) {
                aElement[i].showPlay = i === this._iCurrentStep;
            }
            this.getModel("navModel").setProperty("/elements", aElement);
            //Here the test should work automatically
            var iReplayType = this.getModel('settings').getProperty('/settings/replayType');
            if (iReplayType !== 0) {
                const timeout = 500 * iReplayType;

                new Promise((resolve, reject) => {
                    var wait = setTimeout(() => {
                        clearTimeout(wait);
                        resolve();
                    }, timeout);
                }).then(function () {
                    this.onReplaySingleStep();
                }.bind(this));
            }
        },

        uuidv4: function () {
            var sStr = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0,
                    v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }) + this._iGlobal;
            this._iGlobal = this._iGlobal + 1;
            return sStr;
        },

        _createDialog: function () {
            this._oRecordDialog = sap.ui.xmlfragment(
                "com.ui5.testing.fragment.RecordDialog",
                this
            );
            this._oRecordDialog.setModel(this._oModel, "viewModel");
            this._oRecordDialog.setModel(RecordController.getModel(), "recordModel");
        },

        onRecord: function () {
            RecordController.startRecording();
        },

        onSave: function () {
            //save /codesettings & /test & navModel>/elements - optimiazion potential..
            var oSave = {
                codeSettings: this._oModel.getProperty("/codeSettings"),
                elements: this.getModel("navModel").getProperty("/elements"),
                test: this.getModel("navModel").getProperty("/test")
            };
            ChromeStorage.saveRecord(oSave);
        },

        onDelete: function () {
            var sId = this.getModel("navModel").getProperty("/test/uuid");
            ChromeStorage.deleteTest(sId).then(this.getRouter().navTo("start"));
        },

        onNavBack: function () {
            RecordController.stopRecording();
            this._oRecordDialog.close();
            this.getRouter().navTo("start");
        },

        onStopRecord: function () {
            RecordController.stopRecording();
            this._oRecordDialog.close();
        },

        _onTestCreateQuick: function (oEvent) {
            this._oModel.setProperty("/routeName", oEvent.getParameter('name'));
            this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                oStep.setHighlight(sap.ui.core.MessageType.None);
            });
            this._bQuickMode = true;
            this._initTestCreate(true);
        },

        _onTestCreate: function (oEvent) {
            this._oModel.setProperty("/routeName", oEvent.getParameter('name'));
            this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                oStep.setHighlight(sap.ui.core.MessageType.None);
            });
            this._bQuickMode = false;
            this._initTestCreate(false);
        },

        _initTestCreate: function (bImmediate) {
            this._oModel.setProperty("/replayMode", false);

            this.getModel("navModel").setProperty("/test", {
                uuid: this.uuidv4(),
                createdAt: new Date().getTime()
            });
            this._oModel.setProperty("/codeSettings/language", this.getModel("settings").getProperty("/settings/defaultLanguage"));
            this._oModel.setProperty("/codeSettings/authentification", this.getModel("settings").getProperty("/settings/defaultAuthentification"));
            Communication.fireEvent("getwindowinfo").then(function (oData) {
                if (!oData) {
                    return;
                }
                this._oModel.setProperty("/codeSettings/testName", oData.title);
                this._oModel.setProperty("/codeSettings/testCategory", oData.title);
                this._oModel.setProperty("/codeSettings/testUrl", oData.url);
                RecordController.startRecording(bImmediate);
                if (bImmediate === true) {
                    this._oRecordDialog.close();
                }

                this.getRouter().navTo("testDetails", {
                    TestId: this.getModel("navModel").getProperty("/test/uuid")
                });
            }.bind(this));
        },

        _onItemSelected: function (oData) {
            if (this._bReplayMode === true) {
                return; //NO!
            }

            Navigation.setSelectedItem(oData);
            RecordController.focusPopup();

            if (this._bQuickMode !== true) {
                this.getRouter().navTo("elementCreate", {
                    TestId: this.getModel("navModel").getProperty("/test/uuid"),
                    ElementId: oData.identifier.ui5AbsoluteId
                });
            } else {
                this.getRouter().navTo("elementCreateQuick", {
                    TestId: this.getModel("navModel").getProperty("/test/uuid"),
                    ElementId: oData.identifier.ui5AbsoluteId
                });
            }
        },

        _onTestReplay: function (oEvent) {
            this._oModel.setProperty("/routeName", oEvent.getParameter('name'));
            this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                oStep.setHighlight(sap.ui.core.MessageType.None);
            });
            var sTargetUUID = oEvent.getParameter("arguments").TestId;
            var sCurrentUUID = this.getModel("navModel").getProperty("/test/uuid");
            if (sTargetUUID === this._oTestId && this._oModel.getProperty("/replayMode") === true) {
                if (this.getModel("navModel").getProperty("/elements/" + this._iCurrentStep + "/stepExecuted") === true) {
                    this.replayNextStep();
                }
                return;
            }

            this._oTestId = sTargetUUID;
            this._iCurrentStep = 0;
            if (sCurrentUUID !== sTargetUUID) {
                //we have to read the current data..
                ChromeStorage.get({
                    key: sTargetUUID,
                    success: function (oSave) {
                        if (!oSave) {
                            this.getRouter().navTo("start");
                            return;
                        }
                        oSave = JSON.parse(oSave);
                        this._oModel.setProperty("/codeSettings", oSave.codeSettings);
                        this.getModel("navModel").setProperty("/elements", oSave.elements);
                        this.getModel("navModel").setProperty("/elementLength", oSave.elements.length);
                        this.getModel("navModel").setProperty("/test", oSave.test);
                        this._updatePreview();
                        //this._updatePlayButton();
                        this._replay();
                    }.bind(this)
                });
            } else {
                this._updatePreview();
                //this._updatePlayButton();
                this._replay();
            }
        },

        _onTestRerun: function () {
            this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                oStep.setHighlight(sap.ui.core.MessageType.None);
            });
            this._updatePreview();
            //this._updatePlayButton();
            this._replay();
        },

        _onTestDisplay: function (oEvent) {
            this._oModel.setProperty("/routeName", oEvent.getParameter('name'));
            this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                oStep.setHighlight(sap.ui.core.MessageType.None);
            });
            this._oModel.setProperty("/replayMode", false);
            this._sTestId = oEvent.getParameter("arguments").TestId;
            var sTargetUUID = this._sTestId;
            var sCurrentUUID = this.getModel("navModel").getProperty("/test/uuid");
            if (sCurrentUUID !== sTargetUUID) {
                //we have to read the current data..
                ChromeStorage.get({
                    key: sTargetUUID,
                    success: function (oSave) {
                        if (!oSave) {
                            this.getRouter().navTo("start");
                            return;
                        }
                        oSave = JSON.parse(oSave);
                        this._oModel.setProperty("/codeSettings", oSave.codeSettings);
                        this.getModel("navModel").setProperty("/elements", oSave.elements);
                        this.getModel("navModel").setProperty("/elementLength", oSave.elements.length);
                        this.getModel("navModel").setProperty("/test", oSave.test);
                        this._updatePreview();
                    }.bind(this)
                });
            } else if (this.getModel("recordModel").getProperty("/recording") === true && this._bQuickMode === false) {
                setTimeout(function () {
                    this._oRecordDialog.open();
                }.bind(this), 100);
            }
            this._updatePreview();
        },

        _updatePreview: function () {
            var aStoredItems = this.getModel("navModel").getProperty("/elements");
            var codeSettings = this.getModel('viewModel').getProperty('/codeSettings');
            codeSettings.language = this.getModel('settings').getProperty('/settings/defaultLanguage');
            codeSettings.execComponent = this.getOwnerComponent();
            this._oModel.setProperty("/codes", CodeHelper.getFullCode(codeSettings, aStoredItems));
        },

        onContinueRecording: function () {
            this._oRecordDialog.open();
            RecordController.startRecording();
        },

        onDeleteStep: function (oEvent) {
            var aItem = oEvent.getSource().getBindingContext("navModel").getPath().split("/");
            var sNumber = parseInt(aItem[aItem.length - 1], 10);
            var aElements = this.getModel("navModel").getProperty("/elements");
            aElements.splice(sNumber, 1);
            this.getModel("navModel").setProperty("/elements", aElements);
            this._updatePlayButton();
        },

        onReplayAll: function (oEvent) {
            var sUrl = this._oModel.getProperty("/codeSettings/testUrl");
            this.getView().byId('tblPerformedSteps').getItems().forEach(function (oStep) {
                oStep.setHighlight(sap.ui.core.MessageType.None);
            });
            this._iCurrentStep = -1;
            chrome.permissions.request({
                permissions: ['tabs'],
                origins: [sUrl]
            }, function (granted) {
                if (granted) {
                    this._oModel.setProperty("/replayMode", true);
                    if (this._oModel.getProperty('/routeName') !== "testReplay") {
                        this.getRouter().navTo("testReplay", {
                            TestId: this.getModel("navModel").getProperty("/test/uuid")
                        }, true);
                    } else {
                        this._onTestRerun();
                    }
                }
            }.bind(this));
        },

        onExport: function () {
            var oSave = {
                versionId: "0.2.0",
                codeSettings: this._oModel.getProperty("/codeSettings"),
                elements: this.getModel("navModel").getProperty("/elements"),
                test: this.getModel("navModel").getProperty("/test")
            };

            //fix for cycling object
            delete oSave.codeSettings.execComponent;

            var vLink = document.createElement('a'),
                vBlob = new Blob([JSON.stringify(oSave, null, 2)], {
                    type: "octet/stream"
                }),
                vName = Utils.replaceUnsupportedFileSigns(this._oModel.getProperty('/codeSettings/testName'), '_') + '.json',
                vUrl = window.URL.createObjectURL(vBlob);
            vLink.setAttribute('href', vUrl);
            vLink.setAttribute('download', vName);
            vLink.click();
        },

        onExpandControl: function (oEvent) {
            var oPanel = oEvent.getSource().getParent();
            oPanel.setExpanded(oPanel.getExpanded() === false);
        },

        onUpdatePreview: function () {
            this._updatePreview();
        },

        showCode: function (sId) {
            this._bShowCodeOnly = true;
        },

        _lengthStatusFormatter: function (iLength) {
            return "Success";
        },

        downloadSource: function (oEvent) {
            var sSourceCode = oEvent.getSource().getParent().getContent().filter(c => c instanceof sap.ui.codeeditor.CodeEditor)[0].getValue();
            var element = document.createElement('a');
            element.setAttribute('href', 'data:text/javascript;charset=utf-8,' + encodeURIComponent(sSourceCode));
            var fileName = Utils.replaceUnsupportedFileSigns(oEvent.getSource().getParent().getText(), '_') + '.js';
            element.setAttribute('download', fileName);

            element.style.display = 'none';
            document.body.appendChild(element);

            element.click();
            document.body.removeChild(element);
        },

        onTabChange: function (oEvent) {
            this._oModel.setProperty('/activeTab', oEvent.getSource().getSelectedKey());
        },

        downloadAll: function (oEvent) {
            var zip = new JSZip();
            //take all sources containing code no free text

            if (this._oModel.getProperty('/codeSettings/language') === "OPA") {
                var aSources = this.getView()
                    .byId('codeTab')
                    .getItems()
                    .filter(f => f.getContent().filter(c => c instanceof sap.m.FormattedText)[0].getVisible() === false);
                var test = zip.folder('test');
                var integration = test.folder('integration');
                var customMatcher = test.folder('customMatcher');
                var pages = integration.folder('pages');

                //get all pages
                aSources.filter(t => t.getText().indexOf('Page') > -1)
                    .map(t => ({
                        fileName: Utils.replaceUnsupportedFileSigns(t.getText(), '_') + '.js',
                        source: t.getContent().filter(c => c instanceof sap.ui.codeeditor.CodeEditor)[0].getValue()
                    }))
                    .forEach(c => pages.file(c.fileName, c.source));

                //get all matcher implementation
                aSources.filter(t => t.getText().indexOf('Matcher') > -1)
                    .map(t => ({
                        fileName: Utils.replaceUnsupportedFileSigns(t.getText(), '_') + '.js',
                        source: t.getContent().filter(c => c instanceof sap.ui.codeeditor.CodeEditor)[0].getValue()
                    }))
                    .forEach(c => customMatcher.file(c.fileName, c.source));

                //get all remaining except pages and matcher
                aSources.filter(t => t.getText().indexOf('Matcher') === -1 && t.getText().indexOf('Page') === -1)
                    .map(t => ({
                        fileName: Utils.replaceUnsupportedFileSigns(t.getText(), '_') + '.js',
                        source: t.getContent().filter(c => c instanceof sap.ui.codeeditor.CodeEditor)[0].getValue()
                    }))
                    .forEach(c => integration.file(c.fileName, c.source));
            } else {
                this.getView()
                    .byId('codeTab')
                    .getItems()
                    .filter(f => f.getContent().filter(c => c instanceof sap.m.FormattedText)[0].getVisible() === false)
                    .map(t => ({
                        fileName: Utils.replaceUnsupportedFileSigns(t.getText(), '_') + '.js',
                        source: t.getContent()
                            .filter(c => c instanceof sap.ui.codeeditor.CodeEditor)[0].getValue()
                    }))
                    .forEach(c => zip.file(c.fileName, c.source));
            }

            zip.generateAsync({
                    type: "blob"
                })
                .then(content => saveAs(content, "testCode.zip"));
        },

        onStepClick: function (oEvent) {
            var sPath = oEvent.getSource().getBindingContext('navModel').getPath();
            sPath = sPath.substring(sPath.lastIndexOf('/')+1);       
            this.getRouter().navTo("elementDisplay", {TestId: this._sTestId, ElementId: sPath});
        }
    });
});