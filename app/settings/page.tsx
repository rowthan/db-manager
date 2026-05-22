import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '设置',
  description: 'MongoDB 管理器设置页',
}

export default function SettingsPage() {
  return (
    <div className="h-full overflow-auto bg-[hsl(var(--app-shell-bg))] px-4 py-6 text-[hsl(var(--app-panel-text))] lg:px-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">设置</h1>
          <p className="mt-2 text-sm text-base-content/60">
            这里预留给连接管理、界面偏好和发布默认项。当前版本已经切到系统亮暗模式，并会自动跟随系统主题。
          </p>
        </div>

        <section className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">界面主题</h2>
          <div className="mt-3 rounded-2xl border border-base-300 bg-base-200/60 p-4 text-sm text-base-content/70">
            当前使用 CSS 变量驱动的系统主题方案。你切换系统的 light / dark 模式后，这个页面和数据库页面会自动同步。
          </div>
        </section>
      </div>
    </div>
  )
}
