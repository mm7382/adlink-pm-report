const axios = require('axios');
require('dotenv').config();

class AIService {
    constructor() {
        this.baseUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace('/api/generate', '');
        this.model = process.env.MODEL_NAME || 'qwen3:8b';
        this.initialized = false;
    }

    async init() {
        console.log("[AI] 正在初始化 Ollama 連線...");
        try {
            const tagsRes = await axios.get(this.baseUrl + '/api/tags');
            console.log("[AI] Ollama 服務已啟動");
            const localModels = tagsRes.data.models.map(m => m.name);
            
            if (localModels.includes(this.model) || localModels.includes(this.model + ':latest')) {
                console.log("[AI] 使用設定模型: " + this.model);
            } else {
                console.warn("[AI] 警告: 模型 \"" + this.model + "\" 不存在於本地");
                const fallbacks = ['gemma4:12b', 'gemma4:e4b', 'qwen3:8b', 'qwen2.5-coder:7b', 'qwen2.5vl:7b', 'qwen3-vl:8b', 'bge-m3'];
                let foundFallback = false;
                for (const fb of fallbacks) {
                    if (localModels.includes(fb) || localModels.includes(fb + ':latest')) {
                        console.log("[AI] 自動切換至備用模型: " + fb);
                        this.model = fb;
                        foundFallback = true;
                        break;
                    }
                }
                if (!foundFallback) {
                    if (localModels.length > 0) {
                        this.model = localModels[0];
                        console.log("[AI] 使用本地第一個可用模型: " + this.model);
                    } else {
                        throw new Error("本地 Ollama 沒有任何模型，請先執行 'ollama pull " + this.model + "'");
                    }
                }
            }

            console.log("[AI] 正在執行啟動測試...");
            await this.generate("你好", "測試連線");
            console.log("✅ [AI] Ollama 初始化成功，運作正常");
            this.initialized = true;
            return true;
        } catch (error) {
            console.error("❌ [AI ERROR] 初始化失敗: " + error.message);
            return false;
        }
    }

    async generate(prompt, systemPrompt = '你是一個台灣 PM 助理，請用繁體中文簡單回答。') {
        try {
            const response = await axios.post(this.baseUrl + '/api/generate', {
                model: this.model,
                ...(this.model.startsWith("qwen3") || this.model.startsWith("gemma4") ? { think: false } : {}),
                prompt: "系統提示: " + systemPrompt + "\n\n使用者訊息: " + prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    repeat_penalty: 1.08,
                    num_ctx: Number(process.env.OLLAMA_CONTEXT_LENGTH || 8192)
                }
            });
            return response.data.response;
        } catch (error) {
            console.error("[AI ERROR] 呼叫 Ollama 失敗: " + error.message);
            return "抱歉，目前無法連線到本地 AI 服務。";
        }
    }

    async generateJSON(prompt, systemPrompt) {
        const fullPrompt = prompt + "\n\n請務必僅回傳 JSON 格式，不要有任何額外文字。";
        const result = await this.generate(fullPrompt, systemPrompt);
        try {
            if (!result) return null;
            const jsonMatch = result.match(/\{.*\}/s);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
            return JSON.parse(result);
        } catch (e) {
            console.error("[AI ERROR] JSON 解析失敗");
            return null;
        }
    }
}

module.exports = new AIService();
