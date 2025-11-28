/**
 * 配置监控列表
 * id: 唯一标识
 * name: 显示名称
 * url: 监控地址
 * method: 请求方式 (默认 GET)
 */
const MONITORS = [
  { id: "blog", name: "我的博客", url: "https://yourblog.com" },
  { id: "api", name: "后端 API", url: "https://api.yourdomain.com/health" },
  { id: "google", name: "Google", url: "https://www.google.com" },
  // 你可以在这里添加更多...
];

export default {
  // 1. Cron 触发器：执行监控任务
  async scheduled(event, env, ctx) {
    const results = await Promise.all(
      MONITORS.map(async (monitor) => {
        const start = Date.now();
        let status = "down";
        let latency = 0;
        
        try {
          const resp = await fetch(monitor.url, {
            method: monitor.method || "GET",
            headers: { "User-Agent": "Worker-Nezha-Lite-Monitor" },
            cf: { cacheTtl: 0 } // 禁用缓存
          });
          
          latency = Date.now() - start;
          status = resp.ok ? "up" : "down";
        } catch (e) {
          status = "down";
        }

        return {
          id: monitor.id,
          name: monitor.name,
          url: monitor.url,
          status,
          latency,
          updatedAt: Date.now()
        };
      })
    );

    // 将结果存入 KV，过期时间设为 1 天（或者是你需要的历史保留时间）
    // 这里我们简单存储最新状态，如果要做历史曲线，需要设计更复杂的数据结构
    await env.STATUS_KV.put("monitor_data", JSON.stringify(results));
  },

  // 2. Fetch 触发器：渲染 Dashboard 面板
  async fetch(request, env, ctx) {
    // 从 KV 获取最新数据
    const dataRaw = await env.STATUS_KV.get("monitor_data");
    const monitors = dataRaw ? JSON.parse(dataRaw) : [];

    // 渲染 HTML
    const html = `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Server Status</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          .glass {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          }
          @media (prefers-color-scheme: dark) {
            body { background-color: #111; color: #eee; }
            .glass { background: rgba(30, 30, 30, 0.7); }
          }
        </style>
      </head>
      <body class="bg-gray-100 min-h-screen p-4 sm:p-8">
        <div class="max-w-4xl mx-auto">
          <header class="mb-8 text-center">
            <h1 class="text-3xl font-bold mb-2">🔭 服务监控面板</h1>
            <p class="text-gray-500 text-sm">Real-time Service Status powered by Cloudflare Workers</p>
          </header>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${monitors.length === 0 ? '<p class="text-center col-span-3">暂无数据，请等待 Cron 执行...</p>' : ''}
            
            ${monitors.map(m => `
              <div class="glass rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 transition hover:shadow-md">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="font-semibold text-lg truncate" title="${m.name}">${m.name}</h3>
                  <span class="px-2 py-1 rounded text-xs font-bold ${m.status === 'up' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    ${m.status === 'up' ? '运行中' : '已离线'}
                  </span>
                </div>
                
                <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <div class="flex justify-between">
                    <span>延迟</span>
                    <span class="${getLatencyColor(m.latency)}">${m.latency}ms</span>
                  </div>
                  <div class="flex justify-between">
                    <span>最后更新</span>
                    <span>${new Date(m.updatedAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                <!-- 进度条模拟 -->
                <div class="w-full bg-gray-200 rounded-full h-1.5 mt-4 dark:bg-gray-700">
                  <div class="h-1.5 rounded-full ${m.status === 'up' ? 'bg-green-500' : 'bg-red-500'}" style="width: 100%"></div>
                </div>
              </div>
            `).join('')}
          </div>

          <footer class="mt-12 text-center text-gray-400 text-xs">
            <p>Deployed on Cloudflare Workers</p>
          </footer>
        </div>
        
        <script>
            // 简单的自动刷新
            setTimeout(() => window.location.reload(), 60000);
        </script>
      </body>
      </html>
    `;

    return new Response(html, {
      headers: { "content-type": "text/html;charset=UTF-8" },
    });
  }
};

function getLatencyColor(ms) {
  if (ms < 100) return 'text-green-500 font-bold';
  if (ms < 500) return 'text-yellow-500 font-bold';
  return 'text-red-500 font-bold';
}
