// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT
import {networker} from '../models';

export function ClosePortForwardSession(arg1:string):Promise<networker.PortForwardSession>;

export function FindPortForwardSessions(arg1:string,arg2:string,arg3:networker.FindPortForwardSessionRequest):Promise<Array<networker.PortForwardSession>>;

export function GetPortForwardSession(arg1:string):Promise<networker.PortForwardSession>;

export function GetSupportedPortForwardTargets(arg1:string):Promise<Array<string>>;

export function ListPortForwardSessions(arg1:string,arg2:string):Promise<Array<networker.PortForwardSession>>;

export function StartResourcePortForwardingSession(arg1:string,arg2:string,arg3:networker.PortForwardSessionOptions):Promise<networker.PortForwardSession>;
