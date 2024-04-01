// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT
import {terminal} from '../models';
import {context} from '../models';

export function AttachToSession(arg1:string):Promise<Array<number>>;

export function DetachFromSession(arg1:string):Promise<void>;

export function ListSessions():Promise<Array<terminal.TerminalSessionDetails>>;

export function Run(arg1:context.Context):Promise<void>;

export function SetTTYSize(arg1:string,arg2:number,arg3:number):Promise<void>;

export function StartSession(arg1:Array<string>,arg2:terminal.TerminalSessionOptions):Promise<string>;

export function TerminateSession(arg1:string):Promise<void>;

export function WriteToSession(arg1:string,arg2:string):Promise<void>;