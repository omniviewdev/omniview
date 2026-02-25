// Chat
export {
  ChatBubble,
  ChatAvatar,
  ChatInput,
  ChatMessageList,
  ChatConversation,
  ChatSuggestions,
  ChatDrawer,
  ChatHistory,
  ChatTabs,
  ChatHeader,
} from './chat';

export type {
  ChatBubbleProps,
  ChatBubbleSize,
  ChatAvatarProps,
  ChatInputProps,
  ChatMessageListProps,
  ChatMessage,
  ChatConversationProps,
  ChatSuggestionsProps,
  ChatDrawerProps,
  ChatHistoryProps,
  ConversationSummary,
  ChatTabsProps,
  ChatTab,
  ChatHeaderProps,
} from './chat';

// Content
export {
  AICodeBlock,
  AIMarkdown,
  AIArtifact,
  AIInlineCitation,
  AISources,
} from './content';

export type {
  AICodeBlockProps,
  AIMarkdownProps,
  AIArtifactProps,
  AIInlineCitationProps,
  AISourcesProps,
  AISource,
} from './content';

// Feedback
export {
  TypingIndicator,
  StreamingText,
  ThinkingBlock,
  ChainOfThought,
  ChainOfThoughtStep,
  AILoader,
} from './feedback';

export type {
  TypingIndicatorProps,
  StreamingTextProps,
  ThinkingBlockProps,
  ChainOfThoughtProps,
  ChainOfThoughtStepProps,
  AILoaderProps,
} from './feedback';

// Tools
export {
  ToolCall,
  ToolResult,
  ToolCallList,
  ActionBar,
} from './tools';

export type {
  ToolCallProps,
  ToolResultProps,
  ToolCallListProps,
  ActionBarProps,
} from './tools';

// Agents
export {
  AgentStatusItem,
  AgentPopup,
  AgentTaskList,
  AgentControls,
  AgentBanner,
} from './agents';

export type {
  AgentStatusItemProps,
  AgentStatus,
  AgentPopupProps,
  AgentTaskListProps,
  AgentTask,
  AgentControlsProps,
  AgentBannerProps,
} from './agents';

// Security
export {
  PermissionRequest,
  PermissionBadge,
  PermissionScopeEditor,
  SecurityBanner,
  PermissionGate,
} from './security';

export type {
  PermissionRequestProps,
  PermissionBadgeProps,
  PermissionScopeEditorProps,
  PermissionScope,
  SecurityBannerProps,
  PermissionGateProps,
} from './security';

// Settings
export {
  ProviderCard,
  ModelSelector,
  SettingsPanel,
  MCPServerConfig,
} from './settings';

export type {
  ProviderCardProps,
  ProviderInfo,
  ModelSelectorProps,
  ModelInfo,
  SettingsPanelProps,
  AISettingsValues,
  MCPServerConfigProps,
  MCPServer,
} from './settings';

// Context
export {
  AIContextBar,
} from './context';

export type {
  AIContextBarProps,
} from './context';

// Domain (AI ↔ IDE integration)
export {
  AIResourceCard,
  AICommandSuggestion,
  AILogViewer,
  AIDiffView,
  AIMetricSnapshot,
  AIEventList,
  AIResourceTable,
  AIHealthSummary,
  AIStructuredDataViewer,
  AIActionConfirmation,
  AIRelatedResources,
} from './domain';

export type {
  AIResourceCardProps,
  AICommandSuggestionProps,
  AILogViewerProps,
  AILogLine,
  AIDiffViewProps,
  AIMetricSnapshotProps,
  AIEventListProps,
  AIEvent,
  AIResourceTableProps,
  AIResourceTableColumn,
  AIHealthSummaryProps,
  AIStructuredDataViewerProps,
  AIActionConfirmationProps,
  AIRelatedResourcesProps,
} from './domain';
