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
	export class DevServerManager {
	
	
	    static createFrom(source: any = {}) {
	        return new DevServerManager(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
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
	    lastBuildTime: time.Time;
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
	        this.lastBuildTime = this.convertValues(source["lastBuildTime"], time.Time);
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
	    timestamp: time.Time;
	    source: string;
	    level: string;
	    message: string;
	    pluginID: string;
	
	    static createFrom(source: any = {}) {
	        return new LogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = this.convertValues(source["timestamp"], time.Time);
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
	    created_at: time.Time;
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
	        this.created_at = this.convertValues(source["created_at"], time.Time);
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
	    default_command: string[];
	
	    static createFrom(source: any = {}) {
	        return new Handler(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = source["plugin"];
	        this.resource = source["resource"];
	        this.target_builder = this.convertValues(source["target_builder"], types.ActionTargetBuilder);
	        this.default_command = source["default_command"];
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
	    since_time?: time.Time;
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
	        this.since_time = this.convertValues(source["since_time"], time.Time);
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
	    created_at: time.Time;
	
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
	        this.created_at = this.convertValues(source["created_at"], time.Time);
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

export namespace metric {
	
	export class AggregateValue {
	    metric_id: string;
	    min: number;
	    max: number;
	    avg: number;
	    sum: number;
	    p50: number;
	    p90: number;
	    p99: number;
	    count: number;
	    window: number;
	    labels: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new AggregateValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.metric_id = source["metric_id"];
	        this.min = source["min"];
	        this.max = source["max"];
	        this.avg = source["avg"];
	        this.sum = source["sum"];
	        this.p50 = source["p50"];
	        this.p90 = source["p90"];
	        this.p99 = source["p99"];
	        this.count = source["count"];
	        this.window = source["window"];
	        this.labels = source["labels"];
	    }
	}
	export class ColorRange {
	    min: number;
	    max: number;
	    color: string;
	
	    static createFrom(source: any = {}) {
	        return new ColorRange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.min = source["min"];
	        this.max = source["max"];
	        this.color = source["color"];
	    }
	}
	export class CurrentValue {
	    metric_id: string;
	    value: number;
	    timestamp: time.Time;
	    labels: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new CurrentValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.metric_id = source["metric_id"];
	        this.value = source["value"];
	        this.timestamp = this.convertValues(source["timestamp"], time.Time);
	        this.labels = source["labels"];
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
	export class DataPoint {
	    timestamp: time.Time;
	    value: number;
	    labels: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new DataPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = this.convertValues(source["timestamp"], time.Time);
	        this.value = source["value"];
	        this.labels = source["labels"];
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
	export class MetricDescriptor {
	    id: string;
	    name: string;
	    unit: number;
	    icon: string;
	    color_ranges: ColorRange[];
	    format_string: string;
	    supported_shapes: number[];
	    chart_group: string;
	
	    static createFrom(source: any = {}) {
	        return new MetricDescriptor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.unit = source["unit"];
	        this.icon = source["icon"];
	        this.color_ranges = this.convertValues(source["color_ranges"], ColorRange);
	        this.format_string = source["format_string"];
	        this.supported_shapes = source["supported_shapes"];
	        this.chart_group = source["chart_group"];
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
	    resource: string;
	    metrics: MetricDescriptor[];
	
	    static createFrom(source: any = {}) {
	        return new Handler(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resource = source["resource"];
	        this.metrics = this.convertValues(source["metrics"], MetricDescriptor);
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
	
	export class MetricProviderSummary {
	    plugin_id: string;
	    provider_id: string;
	    name: string;
	    icon: string;
	    description: string;
	    handlers: Handler[];
	
	    static createFrom(source: any = {}) {
	        return new MetricProviderSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin_id = source["plugin_id"];
	        this.provider_id = source["provider_id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.description = source["description"];
	        this.handlers = this.convertValues(source["handlers"], Handler);
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
	export class TimeSeries {
	    metric_id: string;
	    data_points: DataPoint[];
	    labels: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new TimeSeries(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.metric_id = source["metric_id"];
	        this.data_points = this.convertValues(source["data_points"], DataPoint);
	        this.labels = source["labels"];
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
	export class MetricResult {
	    time_series?: TimeSeries;
	    current_value?: CurrentValue;
	    aggregate_value?: AggregateValue;
	
	    static createFrom(source: any = {}) {
	        return new MetricResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time_series = this.convertValues(source["time_series"], TimeSeries);
	        this.current_value = this.convertValues(source["current_value"], CurrentValue);
	        this.aggregate_value = this.convertValues(source["aggregate_value"], AggregateValue);
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
	export class QueryRequest {
	    resource_key: string;
	    resource_id: string;
	    resource_namespace: string;
	    resource_data: Record<string, any>;
	    metric_ids: string[];
	    shape: number;
	    start_time: time.Time;
	    end_time: time.Time;
	    step: number;
	    params: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new QueryRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resource_key = source["resource_key"];
	        this.resource_id = source["resource_id"];
	        this.resource_namespace = source["resource_namespace"];
	        this.resource_data = source["resource_data"];
	        this.metric_ids = source["metric_ids"];
	        this.shape = source["shape"];
	        this.start_time = this.convertValues(source["start_time"], time.Time);
	        this.end_time = this.convertValues(source["end_time"], time.Time);
	        this.step = source["step"];
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
	export class QueryResponse {
	    success: boolean;
	    results: MetricResult[];
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new QueryResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.results = this.convertValues(source["results"], MetricResult);
	        this.error = source["error"];
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
	export class SubscribeRequest {
	    resource_key: string;
	    resource_id: string;
	    resource_namespace: string;
	    resource_data: Record<string, any>;
	    metric_ids: string[];
	    interval: number;
	
	    static createFrom(source: any = {}) {
	        return new SubscribeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resource_key = source["resource_key"];
	        this.resource_id = source["resource_id"];
	        this.resource_namespace = source["resource_namespace"];
	        this.resource_data = source["resource_data"];
	        this.metric_ids = source["metric_ids"];
	        this.interval = source["interval"];
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
	    created_at: time.Time;
	    updated_at: time.Time;
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
	        this.created_at = this.convertValues(source["created_at"], time.Time);
	        this.updated_at = this.convertValues(source["updated_at"], time.Time);
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
	    signature: string;
	    download_url: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new PluginArtifact(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.checksum = source["checksum"];
	        this.signature = source["signature"];
	        this.download_url = source["download_url"];
	        this.size = source["size"];
	    }
	}
	export class PluginVersion {
	    metadata: config.PluginMeta;
	    version: string;
	    architectures: Record<string, PluginArtifact>;
	    created: time.Time;
	    updated: time.Time;
	
	    static createFrom(source: any = {}) {
	        return new PluginVersion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.metadata = this.convertValues(source["metadata"], config.PluginMeta);
	        this.version = source["version"];
	        this.architectures = this.convertValues(source["architectures"], PluginArtifact, true);
	        this.created = this.convertValues(source["created"], time.Time);
	        this.updated = this.convertValues(source["updated"], time.Time);
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

export namespace time {
	
	export class Time {
	
	
	    static createFrom(source: any = {}) {
	        return new Time(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
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
	    timestamp: time.Time;
	    result: Record<string, any>;
	    id: string;
	    command: Command;
	
	    static createFrom(source: any = {}) {
	        return new ScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = this.convertValues(source["timestamp"], time.Time);
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
	export class ActionDescriptor {
	    id: string;
	    label: string;
	    description: string;
	    icon: string;
	    scope: string;
	    streaming: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ActionDescriptor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.description = source["description"];
	        this.icon = source["icon"];
	        this.scope = source["scope"];
	        this.streaming = source["streaming"];
	    }
	}
	export class ActionInput {
	    id: string;
	    namespace: string;
	    params: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new ActionInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.namespace = source["namespace"];
	        this.params = source["params"];
	    }
	}
	export class ActionResult {
	    success: boolean;
	    data: Record<string, any>;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ActionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.data = source["data"];
	        this.message = source["message"];
	    }
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
	    last_refresh: time.Time;
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
	        this.last_refresh = this.convertValues(source["last_refresh"], time.Time);
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
	export class EditorSchema {
	    resourceKey: string;
	    fileMatch: string;
	    uri: string;
	    url?: string;
	    content?: number[];
	    language: string;
	
	    static createFrom(source: any = {}) {
	        return new EditorSchema(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resourceKey = source["resourceKey"];
	        this.fileMatch = source["fileMatch"];
	        this.uri = source["uri"];
	        this.url = source["url"];
	        this.content = source["content"];
	        this.language = source["language"];
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
	export class InformerConnectionSummary {
	    connection: string;
	    resources: Record<string, number>;
	    resourceCounts: Record<string, number>;
	    totalResources: number;
	    syncedCount: number;
	    errorCount: number;
	
	    static createFrom(source: any = {}) {
	        return new InformerConnectionSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connection = source["connection"];
	        this.resources = source["resources"];
	        this.resourceCounts = source["resourceCounts"];
	        this.totalResources = source["totalResources"];
	        this.syncedCount = source["syncedCount"];
	        this.errorCount = source["errorCount"];
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
	    supportedOperations?: number[];
	
	    static createFrom(source: any = {}) {
	        return new ResourceDefinition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id_accessor = source["id_accessor"];
	        this.namespace_accessor = source["namespace_accessor"];
	        this.memoizer_accessor = source["memoizer_accessor"];
	        this.columnDefs = this.convertValues(source["columnDefs"], ColumnDef);
	        this.supportedOperations = source["supportedOperations"];
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

