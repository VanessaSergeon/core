/*
Copyright 2017 OpenFin Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import { AckTemplate,  AckFunc } from './ack';
import { ApiTransportBase, ActionMap, MessagePackage } from './api_transport_base';
import {default as RequestHandler} from './base_handler';

declare var require: any;

const coreState = require('../../core_state');
const electronIpc = require('../../transports/electron_ipc');
const system = require('../../api/system').System;

export class ElipcStrategy extends ApiTransportBase<MessagePackage> {

    constructor(actionMap: ActionMap, requestHandler: RequestHandler<MessagePackage>) {
        super(actionMap, requestHandler);

        this.requestHandler.addHandler((mp: MessagePackage, next) => {
            const {identity, data, ack, nack, e} = mp;
            const action = this.actionMap[data.action];

            if (typeof (action) === 'function') {
                try {
                    // singleFrameOnly check first so to prevent frame superceding when disabled.
                    if (!data.singleFrameOnly === false || e.sender.isValidWithFrameConnect(e.frameRoutingId)) {
                        action(identity, data, ack, nack);
                    } else {
                        nack('API access has been superseded by another frame in this window.');
                    }
                } catch (err) {
                    nack(err);
                }
            }
        });
    }

    public registerMessageHandlers(): void {
        electronIpc.ipc.on(electronIpc.channels.WINDOW_MESSAGE, this.onMessage.bind(this));
    }

    public send(identity: any, payload: any): void {
        const window = coreState.getWindowByUuidName(identity.uuid, identity.name);
        if (window && !window.browserWindow.isDestroyed()) {
            window.browserWindow.send(electronIpc.channels.CORE_MESSAGE, JSON.stringify(payload));
        }
    }

    //TODO: this needs to be refactor at some point.
    public onClientAuthenticated(cb: Function): void {
        throw new Error('Not implemented');
    }

    //TODO: this needs to be refactor at some point.
    public onClientDisconnect(cb: Function): void {
        throw new Error('Not implemented');
    }

    protected onMessage(e: any, rawData: any): void {

        try {
            const data = JSON.parse(JSON.stringify(rawData));
            const ack = !data.isSync ? this.ackDecorator(e, data.messageId) : this.ackDecoratorSync(e, data.messageId);
            const nack = this.nackDecorator(ack);
            const browserWindow = e.sender.getOwnerBrowserWindow();
            const currWindow = browserWindow ? coreState.getWinById(browserWindow.id) : null;
            const openfinWindow = currWindow.openfinWindow;
            const opts = openfinWindow && openfinWindow._options || {};
            const identity = {
                name: opts.name,
                uuid: opts.uuid
            };

            this.requestHandler.handle({
                identity, data, ack, nack, e
            });

        } catch (err) {
            system.debugLog(1, err);
        }
    }

    protected ackDecoratorSync(e: any, messageId: number): AckFunc {
        const ackObj = new AckTemplate();
        ackObj.correlationId = messageId;

        return (payload: any): void => {
            ackObj.payload = payload;

            try {
                // Log all messages when -v=1
                system.debugLog(1, `sent sync in-runtime <= ${JSON.stringify(ackObj)}`);
            } catch (err) {
                /* tslint:disable: no-empty */
            }

            if (!e.sender.isDestroyed()) {
                e.returnValue = JSON.stringify(ackObj);
            }
        };
    }

    protected ackDecorator(e: any, messageId: number): AckFunc {
        const ackObj = new AckTemplate();
        ackObj.correlationId = messageId;

        return (payload: any): void => {
            ackObj.payload = payload;

            try {
                // Log all messages when -v=1
                /* tslint:disable: max-line-length */
                system.debugLog(1, `sent in-runtime <= ${e.frameRoutingId} ${JSON.stringify(ackObj)}`);
            } catch (err) {
                /* tslint:disable: no-empty */
            }

            if (!e.sender.isDestroyed()) {
                e.sender.sendToFrame(e.frameRoutingId, electronIpc.channels.CORE_MESSAGE, JSON.stringify(ackObj));
            }
        };

    }
}