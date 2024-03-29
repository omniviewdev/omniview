// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT
import {services} from '../models';
import {context} from '../models';

export function AttachToSession(arg1:string):Promise<Array<number>>;

export function DetachFromSession(arg1:string):Promise<void>;

export function ListSessions():Promise<Array<services.TerminalSessionDetails>>;

export function Run(arg1:context.Context):Promise<void>;

export function StartSession(arg1:Array<string>,arg2:services.TerminalSessionOptions):Promise<string>;

export function TerminateSession(arg1:string):Promise<void>;

export function WriteToSession(arg1:string,arg2:string):Promise<void>;
