const router = require('./router');
const excelAgent = require('../agents/excelAgent');

class AgentOrchestrator {
    async process(message) {
        try {
            const taskType = await router.route(message);
            
            let result;
            switch (taskType) {
                case 'excel':
                default:
                    result = await excelAgent.handle(message);
                    break;
            }
            return result;
        } catch (error) {
            console.error("[Orchestrator ERROR] " + error.message);
            return "處理請求時發生錯誤：" + error.message;
        }
    }
}

module.exports = new AgentOrchestrator();
