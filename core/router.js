class Router {
    async route(message) {
        console.log("[Router] 統一導向 excelAgent: \"" + message + "\"");
        return 'excel';
    }
}

module.exports = new Router();
