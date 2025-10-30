"use client";

import { useEffect, useState, useRef } from "react";
import { z } from "zod";
import ReactMarkdown from "react-markdown";

// AI消息组件，支持查看调试信息
function AIMessage({ content, rawContent, apiResponse }: { 
  content: string; 
  rawContent?: string; 
  apiResponse?: any[];
}) {
  const [showDebug, setShowDebug] = useState(false);

  return (
    <div>
      {/* 主要内容：过滤后的干净内容 */}
      <div className="markdown-content text-sm">
        <ReactMarkdown
          components={{
            h1: ({children}) => <h1 className="text-lg font-bold mb-1.5">{children}</h1>,
            h2: ({children}) => <h2 className="text-base font-semibold mb-1.5">{children}</h2>,
            h3: ({children}) => <h3 className="text-sm font-medium mb-1">{children}</h3>,
            p: ({children}) => <p className="mb-1.5 leading-relaxed">{children}</p>,
            ul: ({children}) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
            ol: ({children}) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
            li: ({children}) => <li className="ml-1.5">{children}</li>,
            strong: ({children}) => <strong className="font-semibold">{children}</strong>,
            em: ({children}) => <em className="italic">{children}</em>,
            code: ({children}) => <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
            pre: ({children}) => <pre className="bg-muted p-2 rounded-md overflow-x-auto text-xs font-mono mb-1.5">{children}</pre>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      
      {/* 调试信息：完整的API响应 */}
      {(rawContent || apiResponse) && (
        <div className="mt-2">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 underline"
            onClick={() => setShowDebug(!showDebug)}
          >
            {showDebug ? "隐藏调试信息" : "显示调试信息"}
          </button>
          
          {showDebug && (
            <div className="mt-2 p-3 bg-gray-50 border-l-4 border-gray-300 text-xs text-gray-600 space-y-3">
              {rawContent && (
                <div>
                  <div className="font-semibold mb-1">原始内容 (Raw Content):</div>
                  <div className="font-mono whitespace-pre-wrap bg-white p-2 rounded border">
                    {rawContent}
                  </div>
                </div>
              )}
              
              {apiResponse && apiResponse.length > 0 && (
                <div>
                  <div className="font-semibold mb-1">完整API响应 (Full API Response):</div>
                  <div className="font-mono whitespace-pre-wrap bg-white p-2 rounded border max-h-60 overflow-y-auto">
                    {JSON.stringify(apiResponse, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const schema = z.object({
  message: z.string().min(1, "请输入消息").max(10000),
  key: z.string().optional(),
});

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string; // 过滤后的干净内容
  rawContent?: string; // API返回的原始内容（仅AI消息有）
  apiResponse?: any[]; // 完整的API响应JSON数组（用于调试）
  timestamp: string;
};

export default function Page() {
  const [message, setMessage] = useState("");
  const [key, ] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [messages, setMessages] = useState<Message[]>([]);
  const [storageSize, setStorageSize] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMessages = localStorage.getItem("chat-messages");
      if (savedMessages) {
        setMessages(JSON.parse(savedMessages));
      }
      setStorageSize(getStorageSize());
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function toast(s: string) {
    setStatus(s);
    setTimeout(() => setStatus("就绪"), 1600);
  }

  function clearChat() {
    setMessages([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem("chat-messages");
      setStorageSize(getStorageSize());
    }
    toast("聊天记录已清空");
  }

  // 检查localStorage存储大小
  function getStorageSize(): number {
    if (typeof window === 'undefined') return 0;
    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length + key.length;
      }
    }
    return total;
  }

  // 格式化存储大小显示
  function formatStorageSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // 清理旧消息（保留最近的N条）
  function cleanOldMessages(keepCount: number = 50) {
    setMessages((prev) => {
      if (prev.length <= keepCount) return prev;
      
      const recentMessages = prev.slice(-keepCount);
      try {
          if (typeof window !== 'undefined') {
            localStorage.setItem("chat-messages", JSON.stringify(recentMessages));
            setStorageSize(getStorageSize());
          }
          toast(`已清理旧消息，保留最近${keepCount}条`);
        } catch (e) {
        console.error('存储失败:', e);
        toast('存储空间不足，请手动清理');
      }
      return recentMessages;
    });
  }

  function cleanOldMessagesManually() {
    const recentMessages = messages.slice(-20);
    setMessages(recentMessages);
    if (typeof window !== 'undefined') {
      localStorage.setItem("chat-messages", JSON.stringify(recentMessages));
      setStorageSize(getStorageSize());
    }
    toast(`已清理旧消息，保留最近 ${recentMessages.length} 条`);
  }

  function addMessage(role: "user" | "assistant", content: string, rawContent?: string) {
    const timestamp = new Date().toLocaleString();
    const id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const newMessage: Message = { id, role, content, rawContent, timestamp };

    setMessages((prev) => {
      const updatedMessages = [...prev, newMessage];
      
      if (typeof window !== 'undefined') {
        try {
          const dataToStore = JSON.stringify(updatedMessages);
          const currentStorageSize = getStorageSize();
          
          // 检查存储大小，如果超过4MB则自动清理
          if (currentStorageSize > 4 * 1024 * 1024) {
            console.warn('存储空间接近限制，自动清理旧消息');
            // 保留最近30条消息
            const recentMessages = updatedMessages.slice(-30);
            localStorage.setItem("chat-messages", JSON.stringify(recentMessages));
            setStorageSize(getStorageSize());
            toast('存储空间不足，已自动清理旧消息');
            return recentMessages;
          }
          
          localStorage.setItem("chat-messages", dataToStore);
          setStorageSize(getStorageSize());
        } catch (e) {
          console.error('存储失败:', e);
          // 如果存储失败，尝试清理后再存储
          const recentMessages = updatedMessages.slice(-20);
          try {
            localStorage.setItem("chat-messages", JSON.stringify(recentMessages));
            setStorageSize(getStorageSize());
            toast('存储空间不足，已清理部分消息');
            return recentMessages;
          } catch (secondError) {
            console.error('二次存储也失败:', secondError);
            toast('存储失败，请清理浏览器缓存');
          }
        }
      }
      
      return updatedMessages;
    });

    return newMessage;
  }

  async function sendMessage() {
    const check = schema.safeParse({ message, key: key?.trim() });
    if (!check.success) return toast(check.error.issues[0].message);
    const _key = key?.trim() || process.env.NEXT_PUBLIC_PUBLISHABLE_KEY || "";
    if (!_key) return toast("缺少 Key");

    const userMessage = message.trim();
    setMessage("");
    
    // 添加用户消息
    addMessage("user", userMessage);

    setBusy(true);
    setStatus("AI正在生成回复...");

    try {
      await generateStreamResponse(_key, userMessage);
      toast("回复完成");
    } catch (e: unknown) {
      toast((e as Error)?.message || "发送失败");
    } finally {
      setBusy(false);
      setStatus("就绪");
    }
  }

  async function generateStreamResponse(_key: string, userMessage: string) {
    // 构建对话历史
    const conversationHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 添加当前用户消息
    conversationHistory.push({
      role: "user",
      content: userMessage
    });

    const res = await fetch("https://oaiapi.asia/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: conversationHistory,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 4000,
        stream: true, // 启用流式传输
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      const json = safeJson(txt);
      const msg = (json?.error?.message || `HTTP ${res.status}`).slice(0, 200);
      throw new Error(msg);
    }

    // 创建一个临时的AI消息
    const messageId = Date.now().toString();
    const tempMessage: Message = {
      id: messageId,
      role: "assistant",
      content: "",
      rawContent: "",
      timestamp: new Date().toLocaleTimeString(),
    };
    
    setMessages(prev => [...prev, tempMessage]);

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let fullRawContent = "";
    let fullContent = "";
    let apiResponseArray: any[] = []; // 保存所有API响应JSON

    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                console.log('流式传输完成');
                break;
              }

              try {
                const json = JSON.parse(data);
                // 保存每个API响应到数组中
                apiResponseArray.push(json);
                
                const content = json.choices?.[0]?.delta?.content;
                const finishReason = json.choices?.[0]?.finish_reason;
                
                if (content) {
                  fullRawContent += content;
                  fullContent = filterAIResponse(fullRawContent);
                  
                  // 实时更新消息内容，包括API响应数组
                  setMessages(prev => prev.map(msg => 
                    msg.id === messageId 
                      ? { 
                          ...msg, 
                          content: fullContent, 
                          rawContent: fullRawContent,
                          apiResponse: [...apiResponseArray] // 复制数组
                        }
                      : msg
                  ));
                  
                  // 更新状态显示当前字符数
                  setStatus(`正在生成... (${fullContent.length} 字符)`);
                }

                // 检查是否完成
                if (finishReason) {
                  console.log('完成原因:', finishReason);
                  if (finishReason === 'length') {
                    setStatus('回复已达到最大长度限制');
                  }
                  break;
                }
              } catch (e) {
                console.warn('JSON解析错误:', e, '数据:', data);
                // 继续处理下一行，不中断流式传输
              }
            }
          }
        }
      } catch (streamError) {
        console.error('流式传输错误:', streamError);
        // 如果流式传输失败，更新消息显示错误信息
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, content: fullContent + '\n\n[流式传输中断，回复可能不完整]' }
            : msg
        ));
        setStatus('流式传输中断');
      } finally {
        reader.releaseLock();
      }
    }

    // 确保最终状态更新，包含完整的API响应
    if (fullContent) {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { 
              ...msg, 
              content: fullContent, 
              rawContent: fullRawContent,
              apiResponse: apiResponseArray
            }
          : msg
      ));
    }
  }

  async function generateResponse(_key: string, userMessage: string) {
    // 构建对话历史
    const conversationHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 添加当前用户消息
    conversationHistory.push({
      role: "user",
      content: userMessage
    });

    const res = await fetch("https://oaiapi.asia/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: conversationHistory,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2000,
      }),
    });

    const txt = await res.text();
    const json = safeJson(txt);
    if (!res.ok) {
      const msg = (json?.error?.message || `HTTP ${res.status}`).slice(0, 200);
      throw new Error(msg);
    }

    const responseText = json?.choices?.[0]?.message?.content;
    if (!responseText) {
      throw new Error("未返回结果");
    }

    // 过滤AI返回内容中的不需要信息
    const filteredText = filterAIResponse(responseText);
    
    return {
      filteredContent: filteredText,
      rawContent: responseText
    };
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && message.trim()) {
        sendMessage();
      }
    }
  };

  return (
    <main className="mx-auto max-w-4xl h-screen flex flex-col p-4 sm:p-6 overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">AI聊天助手</h1>
          <p className="text-sm text-muted-foreground">
            [model: gemini-2.5-flash] [status: {status}]
          </p>
          <p className="text-xs text-muted-foreground">
            存储: {formatStorageSize(storageSize)} | 消息: {messages.length}条
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="text-xs rounded border px-2 py-1 hover:bg-muted"
            onClick={() => cleanOldMessages(50)}
            disabled={messages.length <= 50}
          >
            清理旧消息
          </button>
          <button
            className="text-sm rounded border px-3 py-1 hover:bg-muted"
            onClick={clearChat}
          >
            清空聊天
          </button>
        </div>
      </div>



      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto border rounded-lg p-4 mb-4 bg-muted/20 messages-container">
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <p>开始与AI助手对话吧！</p>
            <p className="text-xs mt-2">支持多轮对话，按Enter发送消息</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[100%] sm:max-w-[80%] rounded-lg p-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <AIMessage 
                  content={msg.content} 
                  rawContent={msg.rawContent} 
                  apiResponse={msg.apiResponse}
                />
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                  <div className="text-xs opacity-70 mt-1">{msg.timestamp}</div>
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-background border rounded-lg p-3">
                  <div className="flex items-center space-x-2">
                    <div className="animate-pulse">AI正在思考...</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex gap-2">
        <textarea
          className="flex-1 min-h-[60px] max-h-32 rounded-md border p-3 bg-transparent resize-none"
          placeholder="输入你的消息... (Shift+Enter换行，Enter发送)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={busy}
        />
        <button
          className="rounded-md bg-foreground text-background px-6 py-2 disabled:opacity-50 self-end"
          disabled={busy || !message.trim()}
          onClick={sendMessage}
        >
          {busy ? "发送中..." : "发送"}
        </button>
      </div>
    </main>
  );
}

function filterAIResponse(text: string): string {
  let filtered = text;

  // 移除时间戳（格式如：2025/10/24 14:43:18）
  filtered = filtered.replace(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2}/g, '');

  // 移除 *Thinking...* 部分
  filtered = filtered.replace(/\*Thinking\.\.\.\*/g, '');

  // 移除 > ** 开头的思考过程块
  filtered = filtered.replace(/>\s*\*\*[\s\S]*?(?=\n\n|\n[^>]|$)/g, '');

  // 移除多余的空行和空白字符
  filtered = filtered.replace(/\n\s*\n\s*\n/g, '\n\n');
  filtered = filtered.trim();

  return filtered;
}

function safeJson(txt: string) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}