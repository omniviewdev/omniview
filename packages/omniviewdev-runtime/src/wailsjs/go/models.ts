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
		    if (a.slice && a.map) {
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
	export class PluginThemeColors {
	    primary: string;
	    secondary: string;
	    tertiary: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginThemeColors(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.primary = source["primary"];
	        this.secondary = source["secondary"];
	        this.tertiary = source["tertiary"];
	    }
	}
	export class PluginTheme {
	    colors: PluginThemeColors;
	
	    static createFrom(source: any = {}) {
	        return new PluginTheme(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.colors = this.convertValues(source["colors"], PluginThemeColors);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
		    if (a.slice && a.map) {
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

export namespace devserver {
	
	export class DevInfoFile {
	    pid: number;
	    protocol: string;
	    protocolVersion: number;
	    addr: string;
	    vitePort?: number;
	    pluginId?: string;
	    version?: string;
	    startedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new DevInfoFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.protocol = source["protocol"];
	        this.protocolVersion = source["protocolVersion"];
	        this.addr = source["addr"];
	        this.vitePort = source["vitePort"];
	        this.pluginId = source["pluginId"];
	        this.version = source["version"];
	        this.startedAt = source["startedAt"];
	    }
	}
	export class DevServerState {
	    pluginID: string;
	    mode: string;
	    devPath: string;
	    vitePort: number;
	    viteURL: string;
	    viteStatus: string;
	    goStatus: string;
	    lastBuildDuration: number;
	    // Go type: time
	    lastBuildTime: any;
	    lastError: string;
	    grpcConnected: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DevServerState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pluginID = source["pluginID"];
	        this.mode = source["mode"];
	        this.devPath = source["devPath"];
	        this.vitePort = source["vitePort"];
	        this.viteURL = source["viteURL"];
	        this.viteStatus = source["viteStatus"];
	        this.goStatus = source["goStatus"];
	        this.lastBuildDuration = source["lastBuildDuration"];
	        this.lastBuildTime = this.convertValues(source["lastBuildTime"], null);
	        this.lastError = source["lastError"];
	        this.grpcConnected = source["grpcConnected"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class LogEntry {
	    // Go type: time
	    timestamp: any;
	    source: string;
	    level: string;
	    message: string;
	    pluginID: string;
	
	    static createFrom(source: any = {}) {
	        return new LogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = this.convertValues(source["timestamp"], null);
	        this.source = source["source"];
	        this.level = source["level"];
	        this.message = source["message"];
	        this.pluginID = source["pluginID"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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

export namespace exec {
	
	export class Session {
	    // Go type: time
	    created_at: any;
	    labels: Record<string, string>;
	    params: Record<string, string>;
	    id: string;
	    command: string[];
	    attached: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.labels = source["labels"];
	        this.params = source["params"];
	        this.id = source["id"];
	        this.command = source["command"];
	        this.attached = source["attached"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class AttachSessionResult {
	    session?: Session;
	    buffer: string;
	
	    static createFrom(source: any = {}) {
	        return new AttachSessionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session = this.convertValues(source["session"], Session);
	        this.buffer = source["buffer"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class CreateTerminalOptions {
	    labels: Record<string, string>;
	    command: string[];
	
	    static createFrom(source: any = {}) {
	        return new CreateTerminalOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.labels = source["labels"];
	        this.command = source["command"];
	    }
	}
	export class Handler {
	    plugin: string;
	    resource: string;
	    target_builder: types.ActionTargetBuilder;
	
	    static createFrom(source: any = {}) {
	        return new Handler(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = source["plugin"];
	        this.resource = source["resource"];
	        this.target_builder = this.convertValues(source["target_builder"], types.ActionTargetBuilder);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	
	export class SessionOptions {
	    params: Record<string, string>;
	    labels: Record<string, string>;
	    id: string;
	    resource_plugin: string;
	    resource_key: string;
	    resource_data: Record<string, any>;
	    command: string[];
	    tty: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SessionOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.params = source["params"];
	        this.labels = source["labels"];
	        this.id = source["id"];
	        this.resource_plugin = source["resource_plugin"];
	        this.resource_key = source["resource_key"];
	        this.resource_data = source["resource_data"];
	        this.command = source["command"];
	        this.tty = source["tty"];
	    }
	}

}

export namespace logs {
	
	export class LogSessionOptions {
	    target: string;
	    follow: boolean;
	    include_previous: boolean;
	    include_timestamps: boolean;
	    tail_lines: number;
	    since_seconds: number;
	    // Go type: time
	    since_time?: any;
	    limit_bytes: number;
	    include_source_events: boolean;
	    params: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new LogSessionOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.target = source["target"];
	        this.follow = source["follow"];
	        this.include_previous = source["include_previous"];
	        this.include_timestamps = source["include_timestamps"];
	        this.tail_lines = source["tail_lines"];
	        this.since_seconds = source["since_seconds"];
	        this.since_time = this.convertValues(source["since_time"], null);
	        this.limit_bytes = source["limit_bytes"];
	        this.include_source_events = source["include_source_events"];
	        this.params = source["params"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class CreateSessionOptions {
	    resource_key: string;
	    resource_id: string;
	    resource_data: Record<string, any>;
	    options: LogSessionOptions;
	
	    static createFrom(source: any = {}) {
	        return new CreateSessionOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resource_key = source["resource_key"];
	        this.resource_id = source["resource_id"];
	        this.resource_data = source["resource_data"];
	        this.options = this.convertValues(source["options"], LogSessionOptions);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class Handler {
	    plugin: string;
	    resource: string;
	    target_builder: types.ActionTargetBuilder;
	
	    static createFrom(source: any = {}) {
	        return new Handler(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = source["plugin"];
	        this.resource = source["resource"];
	        this.target_builder = this.convertValues(source["target_builder"], types.ActionTargetBuilder);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class LogSource {
	    id: string;
	    labels: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new LogSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.labels = source["labels"];
	    }
	}
	export class LogSession {
	    id: string;
	    plugin_id: string;
	    connection_id: string;
	    resource_key: string;
	    resource_id: string;
	    options: LogSessionOptions;
	    status: number;
	    active_sources: LogSource[];
	    // Go type: time
	    created_at: any;
	
	    static createFrom(source: any = {}) {
	        return new LogSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.plugin_id = source["plugin_id"];
	        this.connection_id = source["connection_id"];
	        this.resource_key = source["resource_key"];
	        this.resource_id = source["resource_id"];
	        this.options = this.convertValues(source["options"], LogSessionOptions);
	        this.status = source["status"];
	        this.active_sources = this.convertValues(source["active_sources"], LogSource);
	        this.created_at = this.convertValues(source["created_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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

export namespace main {
	
	export class FileFilter {
	    displayName: string;
	    pattern: string;
	
	    static createFrom(source: any = {}) {
	        return new FileFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.displayName = source["displayName"];
	        this.pattern = source["pattern"];
	    }
	}
	export class FileDialogOptions {
	    defaultDirectory: string;
	    defaultFilename: string;
	    title: string;
	    filters: FileFilter[];
	    showHiddenFiles: boolean;
	    canCreateDirectories: boolean;
	    resolvesAliases: boolean;
	    treatPackagesAsDirectories: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileDialogOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultDirectory = source["defaultDirectory"];
	        this.defaultFilename = source["defaultFilename"];
	        this.title = source["title"];
	        this.filters = this.convertValues(source["filters"], FileFilter);
	        this.showHiddenFiles = source["showHiddenFiles"];
	        this.canCreateDirectories = source["canCreateDirectories"];
	        this.resolvesAliases = source["resolvesAliases"];
	        this.treatPackagesAsDirectories = source["treatPackagesAsDirectories"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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

export namespace networker {
	
	export class FindPortForwardSessionRequest {
	    resource_id: string;
	    connection_id: string;
	
	    static createFrom(source: any = {}) {
	        return new FindPortForwardSessionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resource_id = source["resource_id"];
	        this.connection_id = source["connection_id"];
	    }
	}
	export class PortForwardSessionEncryption {
	    algorithm: string;
	    key: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PortForwardSessionEncryption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.algorithm = source["algorithm"];
	        this.key = source["key"];
	        this.enabled = source["enabled"];
	    }
	}
	export class PortForwardSession {
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    updated_at: any;
	    connection: any;
	    labels: Record<string, string>;
	    id: string;
	    protocol: string;
	    state: string;
	    connection_type: string;
	    encryption: PortForwardSessionEncryption;
	    local_port: number;
	    remote_port: number;
	
	    static createFrom(source: any = {}) {
	        return new PortForwardSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.updated_at = this.convertValues(source["updated_at"], null);
	        this.connection = source["connection"];
	        this.labels = source["labels"];
	        this.id = source["id"];
	        this.protocol = source["protocol"];
	        this.state = source["state"];
	        this.connection_type = source["connection_type"];
	        this.encryption = this.convertValues(source["encryption"], PortForwardSessionEncryption);
	        this.local_port = source["local_port"];
	        this.remote_port = source["remote_port"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	
	export class PortForwardSessionOptions {
	    connection: any;
	    labels: Record<string, string>;
	    params: Record<string, string>;
	    protocol: string;
	    connection_type: string;
	    encryption: PortForwardSessionEncryption;
	    local_port: number;
	    remote_port: number;
	
	    static createFrom(source: any = {}) {
	        return new PortForwardSessionOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connection = source["connection"];
	        this.labels = source["labels"];
	        this.params = source["params"];
	        this.protocol = source["protocol"];
	        this.connection_type = source["connection_type"];
	        this.encryption = this.convertValues(source["encryption"], PortForwardSessionEncryption);
	        this.local_port = source["local_port"];
	        this.remote_port = source["remote_port"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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

export namespace plugin {
	
	export class LoadPluginOptions {
	    DevMode: boolean;
	    DevModePath: string;
	    ExistingState?: types.PluginState;
	
	    static createFrom(source: any = {}) {
	        return new LoadPluginOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.DevMode = source["DevMode"];
	        this.DevModePath = source["DevModePath"];
	        this.ExistingState = this.convertValues(source["ExistingState"], types.PluginState);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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

export namespace registry {
	
	export class PluginArtifact {
	    checksum: string;
	    download_url: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new PluginArtifact(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.checksum = source["checksum"];
	        this.download_url = source["download_url"];
	        this.size = source["size"];
	    }
	}
	export class PluginVersion {
	    metadata: config.PluginMeta;
	    version: string;
	    architectures: Record<string, PluginArtifact>;
	    // Go type: time
	    created: any;
	    // Go type: time
	    updated: any;
	
	    static createFrom(source: any = {}) {
	        return new PluginVersion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.metadata = this.convertValues(source["metadata"], config.PluginMeta);
	        this.version = source["version"];
	        this.architectures = this.convertValues(source["architectures"], PluginArtifact, true);
	        this.created = this.convertValues(source["created"], null);
	        this.updated = this.convertValues(source["updated"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	    name: string;
	    icon: string;
	    description: string;
	    official: boolean;
	    latest_version: PluginVersion;
	
	    static createFrom(source: any = {}) {
	        return new Plugin(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.description = source["description"];
	        this.official = source["official"];
	        this.latest_version = this.convertValues(source["latest_version"], PluginVersion);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	
	
	export class PluginVersions {
	    Latest: string;
	    Versions: string[];
	
	    static createFrom(source: any = {}) {
	        return new PluginVersions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Latest = source["Latest"];
	        this.Versions = source["Versions"];
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
	export class SettingFileSelection {
	    enabled: boolean;
	    allowFolders: boolean;
	    extensions: string[];
	    multiple: boolean;
	    relative: boolean;
	    defaultPath: string;
	
	    static createFrom(source: any = {}) {
	        return new SettingFileSelection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.allowFolders = source["allowFolders"];
	        this.extensions = source["extensions"];
	        this.multiple = source["multiple"];
	        this.relative = source["relative"];
	        this.defaultPath = source["defaultPath"];
	    }
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
	    fileSelection?: SettingFileSelection;
	    sensitive: boolean;
	
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
	        this.fileSelection = this.convertValues(source["fileSelection"], SettingFileSelection);
	        this.sensitive = source["sensitive"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	    settings: Record<string, Setting>;
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
		    if (a.slice && a.map) {
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

export namespace trivy {
	
	export enum Command {
	    CONFIG = "config",
	    FILESYSTEM = "fs",
	    IMAGE = "image",
	    KUBERNETES = "kubernetes",
	    REPOSITORY = "repository",
	    ROOTFS = "rootfs",
	    SBOM = "sbom",
	}
	export enum Scanner {
	    VULN = "vuln",
	    MISCONFIG = "misconfig",
	    SECRET = "secret",
	    LICENSE = "license",
	}
	export class ScanOptions {
	    filePatterns: string[];
	    skipDirs: string[];
	    skipFiles: string[];
	    scanners: string[];
	
	    static createFrom(source: any = {}) {
	        return new ScanOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePatterns = source["filePatterns"];
	        this.skipDirs = source["skipDirs"];
	        this.skipFiles = source["skipFiles"];
	        this.scanners = source["scanners"];
	    }
	}
	export class ScanResult {
	    // Go type: time
	    timestamp: any;
	    result: Record<string, any>;
	    id: string;
	    command: Command;
	
	    static createFrom(source: any = {}) {
	        return new ScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = this.convertValues(source["timestamp"], null);
	        this.result = source["result"];
	        this.id = source["id"];
	        this.command = source["command"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	
	export enum ConnectionStatusCode {
	    UNKNOWN = "UNKNOWN",
	    CONNECTED = "CONNECTED",
	    DISCONNECTED = "DISCONNECTED",
	    PENDING = "PENDING",
	    FAILED = "FAILED",
	    ERROR = "ERROR",
	    UNAUTHORIZED = "UNAUTHORIZED",
	    FORBIDDEN = "FORBIDDEN",
	    BAD_REQUEST = "BAD_REQUEST",
	    NOT_FOUND = "NOT_FOUND",
	    TIMEOUT = "TIMEOUT",
	    UNAVAILABLE = "UNAVAILABLE",
	    REQUEST_ENTITY_TOO_LARGE = "REQUEST_ENTITY_TOO_LARGE",
	}
	export class ActionTargetBuilder {
	    selectors: Record<string, string>;
	    label_selector: string;
	    label: string;
	    paths: string[];
	
	    static createFrom(source: any = {}) {
	        return new ActionTargetBuilder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.selectors = source["selectors"];
	        this.label_selector = source["label_selector"];
	        this.label = source["label"];
	        this.paths = source["paths"];
	    }
	}
	export class ResourceLink {
	    idAccessor: string;
	    namespaceAccessor: string;
	    namespaced: boolean;
	    resourceKey: string;
	    keyAccessor: string;
	    keyMap: Record<string, string>;
	    detailExtractors: Record<string, string>;
	    displayId: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ResourceLink(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.idAccessor = source["idAccessor"];
	        this.namespaceAccessor = source["namespaceAccessor"];
	        this.namespaced = source["namespaced"];
	        this.resourceKey = source["resourceKey"];
	        this.keyAccessor = source["keyAccessor"];
	        this.keyMap = source["keyMap"];
	        this.detailExtractors = source["detailExtractors"];
	        this.displayId = source["displayId"];
	    }
	}
	export class ColumnDef {
	    id: string;
	    header: string;
	    accessor: string;
	    accessorPriority?: string;
	    colorMap?: Record<string, string>;
	    color?: string;
	    align?: string;
	    hidden?: boolean;
	    width?: number;
	    formatter?: string;
	    component?: string;
	    componentParams?: any;
	    resourceLink?: ResourceLink;
	    valueMap?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ColumnDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.header = source["header"];
	        this.accessor = source["accessor"];
	        this.accessorPriority = source["accessorPriority"];
	        this.colorMap = source["colorMap"];
	        this.color = source["color"];
	        this.align = source["align"];
	        this.hidden = source["hidden"];
	        this.width = source["width"];
	        this.formatter = source["formatter"];
	        this.component = source["component"];
	        this.componentParams = source["componentParams"];
	        this.resourceLink = this.convertValues(source["resourceLink"], ResourceLink);
	        this.valueMap = source["valueMap"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class Connection {
	    // Go type: time
	    last_refresh: any;
	    data: Record<string, any>;
	    labels: Record<string, any>;
	    id: string;
	    uid: string;
	    name: string;
	    description: string;
	    avatar: string;
	    expiry_time: number;
	    Client: any;
	
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
	        this.Client = source["Client"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class ConnectionStatus {
	    connection?: Connection;
	    status: ConnectionStatusCode;
	    error: string;
	    details: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connection = this.convertValues(source["connection"], Connection);
	        this.status = source["status"];
	        this.error = source["error"];
	        this.details = source["details"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	    input: Record<string, any>;
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
	    result: Record<string, any>;
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
	    input: Record<string, any>;
	    params: Record<string, any>;
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
	    result: Record<string, any>;
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
	    params: Record<string, any>;
	    conditions: Record<string, any>;
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
		    if (a.slice && a.map) {
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
	    result: any[];
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
		    if (a.slice && a.map) {
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
	    params: Record<string, any>;
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
	    result: Record<string, any>;
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
		    if (a.slice && a.map) {
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
	    params: Record<string, any>;
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
		    if (a.slice && a.map) {
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
	    result: any[];
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
		    if (a.slice && a.map) {
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
		    if (a.slice && a.map) {
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
	export class PluginState {
	    Metadata: config.PluginMeta;
	    ID: string;
	    DevPath: string;
	    Enabled: boolean;
	    DevMode: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PluginState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Metadata = this.convertValues(source["Metadata"], config.PluginMeta);
	        this.ID = source["ID"];
	        this.DevPath = source["DevPath"];
	        this.Enabled = source["Enabled"];
	        this.DevMode = source["DevMode"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	export class ResourceDefinition {
	    id_accessor: string;
	    namespace_accessor: string;
	    memoizer_accessor: string;
	    columnDefs: ColumnDef[];
	
	    static createFrom(source: any = {}) {
	        return new ResourceDefinition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id_accessor = source["id_accessor"];
	        this.namespace_accessor = source["namespace_accessor"];
	        this.memoizer_accessor = source["memoizer_accessor"];
	        this.columnDefs = this.convertValues(source["columnDefs"], ColumnDef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	    resources: Record<string, Array<ResourceMeta>>;
	
	    static createFrom(source: any = {}) {
	        return new ResourceGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.icon = source["icon"];
	        this.resources = this.convertValues(source["resources"], Array<ResourceMeta>, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
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
	    input: Record<string, any>;
	    params: Record<string, any>;
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
	    result: Record<string, any>;
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

