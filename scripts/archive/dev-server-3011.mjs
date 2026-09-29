// 临时测试服务启动器：PORT 默认 3011
process.env.PORT = process.env.PORT || '3011';
await import('../server/index.js');
