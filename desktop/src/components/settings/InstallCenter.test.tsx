import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import type { SessionListItem } from '../../types/session'

const sessionStoreState: {
  sessions: SessionListItem[]
  fetchSessions: ReturnType<typeof vi.fn>
} = {
  sessions: [],
  fetchSessions: vi.fn(),
}

const chatStoreState: {
  sessions: Record<string, { chatState: 'idle'; pendingComputerUsePermission: { request: unknown } | null }>
  connectToSession: ReturnType<typeof vi.fn>
  disconnectSession: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
  stopGeneration: ReturnType<typeof vi.fn>
} = {
  sessions: {},
  connectToSession: vi.fn(),
  disconnectSession: vi.fn(),
  sendMessage: vi.fn(),
  stopGeneration: vi.fn(),
}

const pluginStoreState = {
  fetchPlugins: vi.fn(),
  reloadPlugins: vi.fn(),
}

const skillStoreState = {
  fetchSkills: vi.fn(),
}

const mcpStoreState = {
  fetchServers: vi.fn(),
}

const uiStoreState = {
  addToast: vi.fn(),
  setPendingSettingsTab: vi.fn(),
}

const { settingsApiState } = vi.hoisted(() => ({
  settingsApiState: {
    getCliLauncherStatus: vi.fn(),
  },
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) =>
    selector(sessionStoreState),
}))

vi.mock('../../stores/chatStore', () => ({
  useChatStore: (selector: (state: typeof chatStoreState) => unknown) =>
    selector(chatStoreState),
}))

vi.mock('../../stores/pluginStore', () => ({
  usePluginStore: (selector: (state: typeof pluginStoreState) => unknown) =>
    selector(pluginStoreState),
}))

vi.mock('../../stores/skillStore', () => ({
  useSkillStore: (selector: (state: typeof skillStoreState) => unknown) =>
    selector(skillStoreState),
}))

vi.mock('../../stores/mcpStore', () => ({
  useMcpStore: (selector: (state: typeof mcpStoreState) => unknown) =>
    selector(mcpStoreState),
}))

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof uiStoreState) => unknown) =>
    selector(uiStoreState),
}))

vi.mock('../../api/settings', () => ({
  settingsApi: settingsApiState,
}))

vi.mock('../../i18n', () => {
  const translations: Record<string, string> = {
    'settings.install.eyebrow': 'AI 安装助手',
    'settings.install.title': '安装中心',
    'settings.install.description': '安装中心描述',
    'settings.install.targets.plugins': 'Plugins',
    'settings.install.targets.mcp': 'MCP',
    'settings.install.targets.skills': 'Skills',
    'settings.install.contextAuto': '默认上下文',
    'settings.install.composeTitle': '自然语言安装',
    'settings.install.composeHint': '安装提示',
    'settings.install.refresh': '刷新安装状态',
    'settings.install.newConversation': '新建安装会话',
    'settings.install.placeholder': '占位符',
    'settings.install.send': '发送安装请求',
    'settings.install.cliTitle': '内置 CLI 命令',
    'settings.install.cliDescription': 'CLI 描述',
    'settings.install.cliLoading': '正在检查内置 CLI launcher 状态…',
    'settings.install.cliReady': '当前终端已可直接使用',
    'settings.install.cliNeedsRestart': '已安装完成；请新开一个终端以加载 PATH 变更。',
    'settings.install.cliPathMissing': 'launcher 已安装，但 PATH 仍未完全就绪。',
    'settings.install.cliUnavailable': '内置 CLI launcher 还没有准备好。',
    'settings.install.cliLocation': 'CLI 路径',
    'settings.install.cliConfigTarget': 'PATH 集成目标：{target}',
    'settings.install.cliError': '内置 CLI 配置告警：{message}',
    'settings.install.cliSharedConfig': '后续如果你想直接通过命令行安装 Skills、Plugins 或 MCP：电脑上本身装了官方 Claude Code，就继续使用 `claude`；如果没有，就使用 `claude-haha`。这两条命令共用同一套 Skills / Plugins / MCP 配置。',
    'settings.install.cliUseOfficial': '如果你已经安装了官方 Claude Code，继续用原版命令：',
    'settings.install.cliUseBundled': '如果没有官方 CLI，就使用我们打包的 `{command}`：',
    'settings.install.contextDefault': '默认目录提示',
    'settings.install.contextUsing': '当前安装会话目录：{path}',
    'settings.install.contextTitle': '执行目录',
    'settings.install.contextHint': '执行目录提示',
    'settings.install.goPlugins': '查看插件',
    'settings.install.goMcp': '查看 MCP',
    'settings.install.goSkills': '查看技能',
    'settings.install.sessionTitle': '安装助手会话',
    'settings.install.sessionHint': '会话提示',
    'settings.install.sessionEmpty': '还没有安装会话',
    'settings.install.sessionEmptyHint': '空会话提示',
    'settings.install.clearConversation': '清除对话',
    'settings.install.clearConversationReady': '已清除当前安装对话；下一条请求会启动新的安装上下文。',
    'settings.install.newConversationReady': '已准备新的安装会话；下一条请求会启动新的安装上下文。',
  }

  return {
    useTranslation: () => (
      key: string,
      params?: Record<string, string | number>,
    ) => {
      let text = translations[key] ?? key
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value))
        }
      }
      return text
    },
  }
})

vi.mock('../chat/MessageList', () => ({
  MessageList: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="message-list">session:{sessionId}</div>
  ),
}))

vi.mock('../chat/ComputerUsePermissionModal', () => ({
  ComputerUsePermissionModal: () => null,
}))

vi.mock('../shared/DirectoryPicker', () => ({
  DirectoryPicker: () => <div>Directory picker</div>,
}))

import { InstallCenter } from './InstallCenter'

describe('InstallCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()

    sessionStoreState.sessions = [
      {
        id: 'installer-1',
        title: '安装助手会话',
        createdAt: '2026-04-23T00:00:00.000Z',
        modifiedAt: '2026-04-23T00:00:00.000Z',
        messageCount: 2,
        projectPath: '',
        workDir: '/Users/nanmi',
        workDirExists: true,
      },
    ]
    sessionStoreState.fetchSessions = vi.fn()

    chatStoreState.sessions = {
      'installer-1': {
        chatState: 'idle',
        pendingComputerUsePermission: null,
      },
    }
    chatStoreState.connectToSession = vi.fn()
    chatStoreState.disconnectSession = vi.fn()
    chatStoreState.sendMessage = vi.fn()
    chatStoreState.stopGeneration = vi.fn()

    pluginStoreState.fetchPlugins = vi.fn()
    pluginStoreState.reloadPlugins = vi.fn()
    skillStoreState.fetchSkills = vi.fn()
    mcpStoreState.fetchServers = vi.fn()
    uiStoreState.addToast = vi.fn()
    uiStoreState.setPendingSettingsTab = vi.fn()
    settingsApiState.getCliLauncherStatus = vi.fn().mockResolvedValue({
      supported: true,
      command: 'claude-haha',
      installed: true,
      launcherPath: '/Users/nanmi/.local/bin/claude-haha',
      binDir: '/Users/nanmi/.local/bin',
      pathConfigured: true,
      pathInCurrentShell: false,
      availableInNewTerminals: true,
      needsTerminalRestart: true,
      configTarget: '/Users/nanmi/.zshrc',
      lastError: null,
    })

    window.localStorage.setItem('cc-haha-installer-session-id', 'installer-1')
    window.localStorage.setItem('cc-haha-installer-context-dir', '/Users/nanmi')
  })

  it('shows bundled cli launcher status', async () => {
    render(<InstallCenter />)

    expect(await screen.findByText('claude-haha')).toBeInTheDocument()
    expect(screen.getByText('已安装完成；请新开一个终端以加载 PATH 变更。')).toBeInTheDocument()
    expect(screen.getByText(/共用同一套 Skills \/ Plugins \/ MCP 配置/)).toBeInTheDocument()
    expect(
      screen.getByText(
        'claude plugin install skill-creator@claude-plugins-official --scope user',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'claude-haha mcp add docs --transport http https://example.com/mcp',
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toHaveTextContent('session:installer-1')
  })
})
