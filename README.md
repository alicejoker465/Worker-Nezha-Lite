我们将这个项目命名为 Worker-Nezha-Lite。
核心原理
监控端 (Cron)：利用 Workers 的 Cron Trigger，每分钟自动唤醒一次，并发请求你配置的目标 URL。
数据端 (KV)：将请求的响应时间（Latency）、状态码（200/500）存入 Cloudflare KV。
展示端 (Dashboard)：当用户访问 Worker 的 URL 时，读取 KV 数据，渲染一个好看的 HTML 面板（仿哪吒 UI）。
项目代码与结构
你需要创建三个文件：wrangler.toml (配置文件)，package.json (依赖)，和 src/index.js (核心代码)。
1. wrangler.toml (配置文件)
请将 <你的KV_ID> 替换为你后面创建的 KV ID。
code
Toml
name = "worker-nezha-lite"
main = "src/index.js"
compatibility_date = "2023-10-30"

# 绑定 KV 存储
[[kv_namespaces]]
binding = "STATUS_KV"
id = "<你的KV_ID>"

# 设置定时任务，每分钟执行一次
[triggers]
crons = ["* * * * *"]
2. package.json
code
JSON
{
  "name": "worker-nezha-lite",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
3. src/index.js (核心逻辑)
这是最关键的部分，包含配置、监控逻辑和前端 UI。
code
JavaScript
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
🚀 部署步骤（保姆级教程）
想要让这个项目在 Github 上受欢迎，你必须在 README 中写清楚以下部署流程：
第一步：准备环境
确保你安装了 Node.js。
安装 Wrangler (Cloudflare 的命令行工具)：
code
Bash
npm install -g wrangler
登录 Cloudflare：
code
Bash
wrangler login
第二步：创建 KV 命名空间
KV 是用来存监控数据的。在终端运行：
code
Bash
wrangler kv:namespace create "STATUS_KV"
终端会输出类似这样的内容：
code
Code
{ binding = "STATUS_KV", id = "xxxxxxxxxxxxxxxxxxxxx" }
关键点：把这个 id 复制下来，粘贴到 wrangler.toml 文件中的 <你的KV_ID> 位置。
第三步：配置监控目标
打开 src/index.js，修改顶部的 MONITORS 数组，填入你想监控的 URL。
第四步：部署到 Cloudflare
code
Bash
wrangler deploy
部署成功后，你会获得一个 URL（例如 https://worker-nezha-lite.yourname.workers.dev）。
第五步：触发第一次监控
因为 Cron 是每分钟触发一次，刚部署完可能没数据。
你可以等待 1 分钟。
或者在 Cloudflare 后台 -> Workers -> 你的项目 -> Triggers -> Cron Triggers 点击 "Test Cron" 手动触发一次。
💡 如何包装让它在 Github 增加星星？
项目名称：取个洋气的名字，比如 UptimeFlare 或 Serverless-Status-Page。
截图：部署好后，截图那个漂亮的面板，放在 README 的第一行。
卖点（Features）：
✅ Free forever: Runs on Cloudflare Workers free tier.
✅ Serverless: No VPS needed.
✅ Global Monitoring: Checks from Cloudflare's edge network.
✅ Customizable: Easy to change styles and targets.
一键部署按钮：
在 README 中加上 Cloudflare 的 "Deploy to Workers" 按钮（Cloudflare 官方提供了这个链接生成器），让小白也能一键 Fork + 部署。
进阶优化思路（作为后续更新方向）
Telegram/微信通知：在 scheduled 函数中，如果检测到 status === 'down'，调用 Telegram Bot API 发送报警。
历史图表：将数据存入 Cloudflare D1 (SQL 数据库)，然后在前端用 Chart.js 画出 24小时延迟曲线（这更像哪吒）。
这个项目结构简单，但解决了刚需（免费、无服务器监控），非常适合作为 Github 的开源项目。
