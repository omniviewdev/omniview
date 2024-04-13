// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT
import {types} from '../models';

export function AddConnection(arg1:string,arg2:types.Connection):Promise<void>;

export function Create(arg1:string,arg2:string,arg3:string,arg4:types.CreateInput):Promise<types.CreateResult>;

export function Delete(arg1:string,arg2:string,arg3:string,arg4:types.DeleteInput):Promise<types.DeleteResult>;

export function Find(arg1:string,arg2:string,arg3:string,arg4:types.FindInput):Promise<types.FindResult>;

export function Get(arg1:string,arg2:string,arg3:string,arg4:types.GetInput):Promise<types.GetResult>;

export function GetConnection(arg1:string,arg2:string):Promise<types.Connection>;

export function GetConnectionNamespaces(arg1:string,arg2:string):Promise<Array<string>>;

export function GetDefaultLayout(arg1:string):Promise<Array<types.LayoutItem>>;

export function GetLayout(arg1:string,arg2:string):Promise<Array<types.LayoutItem>>;

export function GetResourceDefinition(arg1:string,arg2:string):Promise<types.ResourceDefinition>;

export function GetResourceGroup(arg1:string,arg2:string):Promise<types.ResourceGroup>;

export function GetResourceGroups(arg1:string,arg2:string):Promise<{[key: string]: types.ResourceGroup}>;

export function GetResourceType(arg1:string,arg2:string):Promise<types.ResourceMeta>;

export function GetResourceTypes(arg1:string,arg2:string):Promise<{[key: string]: types.ResourceMeta}>;

export function HasResourceType(arg1:string,arg2:string):Promise<boolean>;

export function List(arg1:string,arg2:string,arg3:string,arg4:types.ListInput):Promise<types.ListResult>;

export function ListConnections(arg1:string):Promise<Array<types.Connection>>;

export function ListPlugins():Promise<Array<string>>;

export function LoadConnections(arg1:string):Promise<Array<types.Connection>>;

export function RemoveConnection(arg1:string,arg2:string):Promise<void>;

export function SetLayout(arg1:string,arg2:string,arg3:Array<types.LayoutItem>):Promise<void>;

export function StartConnection(arg1:string,arg2:string):Promise<types.ConnectionStatus>;

export function StartConnectionInformer(arg1:string,arg2:string):Promise<void>;

export function StopConnection(arg1:string,arg2:string):Promise<types.Connection>;

export function StopConnectionInformer(arg1:string,arg2:string):Promise<void>;

export function Update(arg1:string,arg2:string,arg3:string,arg4:types.UpdateInput):Promise<types.UpdateResult>;

export function UpdateConnection(arg1:string,arg2:types.Connection):Promise<types.Connection>;
