// 启动测试服务（默认 3012）
process.env.PORT = process.env.PORT || '3012';
await import('../server/index.js');
