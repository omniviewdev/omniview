export namespace config {
	
	export class PluginResourceComponent {
	    name: string;
	    plugin: string;
	    area: string;
	    resources: string[];
	    extension: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginResourceComponent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.plugin = source["plugin"];
	        this.area = source["area"];
	        this.resources = source["resources"];
	        this.extension = source["extension"];
	    }
	}
	export class PluginComponents {
	    resource: PluginResourceComponent[];
	
	    static createFrom(source: any = {}) {
	        return new PluginComponents(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resource = this.convertValues(source["resource"], PluginResourceComponent);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PluginMaintainer {
	    name: string;
	    email: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginMaintainer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.email = source["email"];
	    }
	}
	export class PluginTheme {
	    // Go type: struct { Primary string "json:\"primary\"   yaml:\"primary\""; Secondary string "json:\"secondary\" yaml:\"secondary\""; Tertiary string "json:\"tertiary\"  yaml:\"tertiary\"" }
	    colors: any;
	
	    static createFrom(source: any = {}) {
	        return new PluginTheme(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.colors = this.convertValues(source["colors"], Object);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PluginMeta {
	    id: string;
	    version: string;
	    name: string;
	    icon: string;
	    description: string;
	    repository: string;
	    website: string;
	    maintainers: PluginMaintainer[];
	    tags: string[];
	    dependencies: string[];
	    capabilities: string[];
	    theme: PluginTheme;
	    components: PluginComponents;
	
	    static createFrom(source: any = {}) {
	        return new PluginMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.version = source["version"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.description = source["description"];
	        this.repository = source["repository"];
	        this.website = source["website"];
	        this.maintainers = this.convertValues(source["maintainers"], PluginMaintainer);
	        this.tags = source["tags"];
	        this.dependencies = source["dependencies"];
	        this.capabilities = source["capabilities"];
	        this.theme = this.convertValues(source["theme"], PluginTheme);
	        this.components = this.convertValues(source["components"], PluginComponents);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace resources {
	
	export class GetOptions {
	    cluster: string;
	    name: string;
	    namespace: string;
	    labels?: {[key: string]: string};
	
	    static createFrom(source: any = {}) {
	        return new GetOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cluster = source["cluster"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.labels = source["labels"];
	    }
	}
	export class ListOptions {
	    clusters: string[];
	    name?: string;
	    namespaces?: string[];
	    labels?: {[key: string]: string};
	
	    static createFrom(source: any = {}) {
	        return new ListOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.clusters = source["clusters"];
	        this.name = source["name"];
	        this.namespaces = source["namespaces"];
	        this.labels = source["labels"];
	    }
	}

}

export namespace services {
	
	export class ClusterContext {
	    resourceStates: {[key: string]: number};
	    name: string;
	    kubeconfig: string;
	
	    static createFrom(source: any = {}) {
	        return new ClusterContext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resourceStates = source["resourceStates"];
	        this.name = source["name"];
	        this.kubeconfig = source["kubeconfig"];
	    }
	}
	
	export class TerminalSessionDetails {
	    labels: {[key: string]: string};
	    id: string;
	    command: string;
	    attached: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TerminalSessionDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.labels = source["labels"];
	        this.id = source["id"];
	        this.command = source["command"];
	        this.attached = source["attached"];
	    }
	}
	export class TerminalSessionOptions {
	    labels: {[key: string]: string};
	    kubeconfig: string;
	    context: string;
	
	    static createFrom(source: any = {}) {
	        return new TerminalSessionOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.labels = source["labels"];
	        this.kubeconfig = source["kubeconfig"];
	        this.context = source["context"];
	    }
	}

}

export namespace settings {
	
	export enum SettingType {
	    TEXT = "text",
	    INTEGER = "integer",
	    FLOAT = "float",
	    TOGGLE = "toggle",
	    COLOR = "color",
	    DATETIME = "datetime",
	    PASSWORD = "password",
	}
	export class SettingOption {
	    label: string;
	    description: string;
	    value: any;
	
	    static createFrom(source: any = {}) {
	        return new SettingOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.description = source["description"];
	        this.value = source["value"];
	    }
	}
	export class Setting {
	    id: string;
	    label: string;
	    description: string;
	    type: SettingType;
	    value: any;
	    default: any;
	    options: SettingOption[];
	
	    static createFrom(source: any = {}) {
	        return new Setting(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.value = source["value"];
	        this.default = source["default"];
	        this.options = this.convertValues(source["options"], SettingOption);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Category {
	    settings: {[key: string]: Setting};
	    id: string;
	    label: string;
	    description: string;
	    icon: string;
	
	    static createFrom(source: any = {}) {
	        return new Category(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.settings = this.convertValues(source["settings"], Setting, true);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.description = source["description"];
	        this.icon = source["icon"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace types {
	
	export class Connection {
	    // Go type: time
	    last_refresh: any;
	    data: {[key: string]: any};
	    labels: {[key: string]: any};
	    id: string;
	    uid: string;
	    name: string;
	    description: string;
	    avatar: string;
	    expiry_time: number;
	
	    static createFrom(source: any = {}) {
	        return new Connection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.last_refresh = this.convertValues(source["last_refresh"], null);
	        this.data = source["data"];
	        this.labels = source["labels"];
	        this.id = source["id"];
	        this.uid = source["uid"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.avatar = source["avatar"];
	        this.expiry_time = source["expiry_time"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CreateInput {
	    params: any;
	    input: {[key: string]: any};
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.params = source["params"];
	        this.input = source["input"];
	        this.namespace = source["namespace"];
	    }
	}
	export class CreateResult {
	    result: {[key: string]: any};
	    success: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CreateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.success = source["success"];
	    }
	}
	export class DeleteInput {
	    input: {[key: string]: any};
	    params: {[key: string]: any};
	    id: string;
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new DeleteInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.input = source["input"];
	        this.params = source["params"];
	        this.id = source["id"];
	        this.namespace = source["namespace"];
	    }
	}
	export class DeleteResult {
	    result: {[key: string]: any};
	    success: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DeleteResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.success = source["success"];
	    }
	}
	export class PaginationParams {
	    page: number;
	    pageSize: number;
	
	    static createFrom(source: any = {}) {
	        return new PaginationParams(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	    }
	}
	export class OrderParams {
	    by: string;
	    direction: boolean;
	
	    static createFrom(source: any = {}) {
	        return new OrderParams(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.by = source["by"];
	        this.direction = source["direction"];
	    }
	}
	export class FindInput {
	    params: {[key: string]: any};
	    conditions: {[key: string]: any};
	    namespaces: string[];
	    order: OrderParams;
	    pagination: PaginationParams;
	
	    static createFrom(source: any = {}) {
	        return new FindInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.params = source["params"];
	        this.conditions = source["conditions"];
	        this.namespaces = source["namespaces"];
	        this.order = this.convertValues(source["order"], OrderParams);
	        this.pagination = this.convertValues(source["pagination"], PaginationParams);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PaginationResult {
	    page: number;
	    pageSize: number;
	    total: number;
	    pages: number;
	
	    static createFrom(source: any = {}) {
	        return new PaginationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.total = source["total"];
	        this.pages = source["pages"];
	    }
	}
	export class FindResult {
	    result: {[key: string]: any};
	    success: boolean;
	    pagination: PaginationResult;
	
	    static createFrom(source: any = {}) {
	        return new FindResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.success = source["success"];
	        this.pagination = this.convertValues(source["pagination"], PaginationResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class GetInput {
	    params: {[key: string]: any};
	    id: string;
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new GetInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.params = source["params"];
	        this.id = source["id"];
	        this.namespace = source["namespace"];
	    }
	}
	export class GetResult {
	    result: {[key: string]: any};
	    success: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GetResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.success = source["success"];
	    }
	}
	export class LayoutItem {
	    id: string;
	    title: string;
	    icon: string;
	    description: string;
	    items: LayoutItem[];
	
	    static createFrom(source: any = {}) {
	        return new LayoutItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.icon = source["icon"];
	        this.description = source["description"];
	        this.items = this.convertValues(source["items"], LayoutItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ListInput {
	    params: {[key: string]: any};
	    namespaces: string[];
	    order: OrderParams;
	    pagination: PaginationParams;
	
	    static createFrom(source: any = {}) {
	        return new ListInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.params = source["params"];
	        this.namespaces = source["namespaces"];
	        this.order = this.convertValues(source["order"], OrderParams);
	        this.pagination = this.convertValues(source["pagination"], PaginationParams);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ListResult {
	    result: {[key: string]: any};
	    success: boolean;
	    pagination: PaginationResult;
	
	    static createFrom(source: any = {}) {
	        return new ListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.success = source["success"];
	        this.pagination = this.convertValues(source["pagination"], PaginationResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class Plugin {
	    id: string;
	    metadata: config.PluginMeta;
	    // Go type: config
	    config: any;
	    enabled: boolean;
	    running: boolean;
	    devMode: boolean;
	    devPath: string;
	    loading: boolean;
	    loadError: string;
	    capabilities: number[];
	
	    static createFrom(source: any = {}) {
	        return new Plugin(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.metadata = this.convertValues(source["metadata"], config.PluginMeta);
	        this.config = this.convertValues(source["config"], null);
	        this.enabled = source["enabled"];
	        this.running = source["running"];
	        this.devMode = source["devMode"];
	        this.devPath = source["devPath"];
	        this.loading = source["loading"];
	        this.loadError = source["loadError"];
	        this.capabilities = source["capabilities"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ResourceGroup {
	    id: string;
	    name: string;
	    description: string;
	    icon: string;
	    resources: {[key: string]: ResourceMeta[]};
	
	    static createFrom(source: any = {}) {
	        return new ResourceGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.icon = source["icon"];
	        this.resources = source["resources"];
	    }
	}
	export class ResourceMeta {
	    group: string;
	    version: string;
	    kind: string;
	    label: string;
	    icon: string;
	    description: string;
	    category: string;
	
	    static createFrom(source: any = {}) {
	        return new ResourceMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.group = source["group"];
	        this.version = source["version"];
	        this.kind = source["kind"];
	        this.label = source["label"];
	        this.icon = source["icon"];
	        this.description = source["description"];
	        this.category = source["category"];
	    }
	}
	export class UpdateInput {
	    input: {[key: string]: any};
	    params: {[key: string]: any};
	    id: string;
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.input = source["input"];
	        this.params = source["params"];
	        this.id = source["id"];
	        this.namespace = source["namespace"];
	    }
	}
	export class UpdateResult {
	    result: {[key: string]: any};
	    success: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UpdateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.success = source["success"];
	    }
	}

}

export namespace ui {
	
	export class GetPluginComponentsInput {
	    plugin: string;
	
	    static createFrom(source: any = {}) {
	        return new GetPluginComponentsInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = source["plugin"];
	    }
	}
	export class GetResourceAreaComponentInput {
	    plugin: string;
	    resource: string;
	    area: string;
	
	    static createFrom(source: any = {}) {
	        return new GetResourceAreaComponentInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = source["plugin"];
	        this.resource = source["resource"];
	        this.area = source["area"];
	    }
	}
	export class GetResourceComponentsInput {
	    plugin: string;
	    resource: string;
	
	    static createFrom(source: any = {}) {
	        return new GetResourceComponentsInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = source["plugin"];
	        this.resource = source["resource"];
	    }
	}
	export class ResourceComponent {
	    owner: string;
	    name: string;
	    plugin: string;
	    resource: string;
	    area: string;
	    extension: string;
	
	    static createFrom(source: any = {}) {
	        return new ResourceComponent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.owner = source["owner"];
	        this.name = source["name"];
	        this.plugin = source["plugin"];
	        this.resource = source["resource"];
	        this.area = source["area"];
	        this.extension = source["extension"];
	    }
	}

}

export namespace utils {
	
	export class GetLanguageInput {
	    filename: string;
	    contents: string;
	
	    static createFrom(source: any = {}) {
	        return new GetLanguageInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filename = source["filename"];
	        this.contents = source["contents"];
	    }
	}

}

