export namespace config {
	
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

export namespace types {
	
	export class Plugin {
	    id: string;
	    metadata: config.PluginMeta;
	    // Go type: config
	    config: any;
	    enabled: boolean;
	    running: boolean;
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

}

