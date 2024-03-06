export namespace clusters {
	
	export class ClusterContext {
	    name: string;
	    user: string;
	
	    static createFrom(source: any = {}) {
	        return new ClusterContext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.user = source["user"];
	    }
	}
	export class ClusterInfo {
	    name: string;
	    version: string;
	    description: string;
	    icon: string;
	    kubeconfig: string;
	    distribution: string;
	    cloud: string;
	    region: string;
	    contexts: ClusterContext[];
	
	    static createFrom(source: any = {}) {
	        return new ClusterInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.icon = source["icon"];
	        this.kubeconfig = source["kubeconfig"];
	        this.distribution = source["distribution"];
	        this.cloud = source["cloud"];
	        this.region = source["region"];
	        this.contexts = this.convertValues(source["contexts"], ClusterContext);
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
	export class ClusterInfos {
	    clusters: {[key: string]: ClusterInfo};
	
	    static createFrom(source: any = {}) {
	        return new ClusterInfos(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.clusters = source["clusters"];
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

