// 启动叠塔测试服务
process.env.PORT = process.env.PORT || '3011';
await import('../server/index.js');
