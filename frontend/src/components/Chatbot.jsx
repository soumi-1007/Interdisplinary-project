import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { MessageSquare, Send, X, Bot, User, Mic, MicOff, Globe, Volume2, CheckCircle2, AlertTriangle, Info } from 'lucide-react'

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [lastLanguage, setLastLanguage] = useState('English') // 'English' or 'Tamil'
  const [sessionMemory, setSessionMemory] = useState({
    lastLanguage: 'English',
    lastDistrict: null,
    lastCrop: null,
    predictionSession: null
  })
  
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      content: 'Hello! I am your Smart Coop & Soil Advisory Assistant. Ask me about fertilizers, schemes, announcements, or agricultural soil suitability across Tamil Nadu!'
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState(null)
  const [voiceNotice, setVoiceNotice] = useState('')
  
  const messagesEndRef = useRef(null)
  const recognitionRef = useRef(null)

  const speechLang = lastLanguage === 'Tamil' ? 'ta-IN' : 'en-IN'

  const suggestions = [
    { label: '🌾 Salem Crops', question: 'What crop is suitable in Salem?' },
    { label: '🌱 Groundnut Soil', question: 'Is groundnut suitable for Salem?' },
    { label: '💧 Rice Water Req', question: 'What is the water requirement for rice in Thanjavur?' },
    { label: '📦 Urea Stock', question: 'Is urea available?' },
    { label: '📋 Eligible Schemes', question: 'Which government schemes am I eligible for?' },
    { label: 'தமிழ் பயிர்', question: 'சேலத்தில் எந்த பயிர் ஏற்றது?' }
  ]

  useEffect(() => {
    if (isOpen) {
      scrollToBottom()
    }
  }, [messages, loading, isOpen])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Initialize Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = speechLang

      recognition.onstart = () => {
        setIsListening(true)
        setVoiceNotice(`Listening in ${lastLanguage}... Speak now`)
      }

      recognition.onresult = (event) => {
        let interimTranscript = ''
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript
          } else {
            interimTranscript += event.results[i][0].transcript
          }
        }

        const transcript = finalTranscript || interimTranscript
        if (transcript) {
          setInput(transcript)
        }
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
        if (event.error === 'not-allowed') {
          setVoiceNotice('Microphone access denied. Please allow permissions in your browser.')
        } else if (event.error === 'no-speech') {
          setVoiceNotice('No speech detected. Please try speaking again.')
        } else {
          setVoiceNotice(`Voice recognition error: ${event.error}`)
        }
        setTimeout(() => setVoiceNotice(''), 4000)
      }

      recognition.onend = () => {
        setIsListening(false)
        setVoiceNotice('')
      }

      recognitionRef.current = recognition
    }
  }, [speechLang, lastLanguage])

  const toggleListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.')
      return
    }

    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
    } else {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.lang = speechLang
          recognitionRef.current.start()
        }
      } catch (e) {
        console.error('Failed to start speech recognition:', e)
      }
    }
  }

  // FEATURE 10 & 11: Speech Synthesis speaks ONLY the clean answer text string (ttsText)
  const speakMessage = (msg, index) => {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported in this browser.')
      return
    }

    window.speechSynthesis.cancel() // Stop any current speech

    if (speakingIndex === index) {
      setSpeakingIndex(null)
      return
    }

    const textToSpeak = (msg.ttsText || msg.content).replace(/[*#_`]/g, '').trim()
    const utterance = new SpeechSynthesisUtterance(textToSpeak)
    utterance.lang = speechLang

    utterance.onstart = () => setSpeakingIndex(index)
    utterance.onend = () => setSpeakingIndex(null)
    utterance.onerror = () => setSpeakingIndex(null)

    window.speechSynthesis.speak(utterance)
  }

  const handleLanguageChange = (newLang) => {
    setLastLanguage(newLang)
    setSessionMemory(prev => ({ ...prev, lastLanguage: newLang }))
  }

  const handleSend = async (messageText) => {
    const textToSend = messageText || input
    if (!textToSend.trim()) return

    const userMessage = { role: 'user', content: textToSend }
    setMessages(prev => [...prev, userMessage])
    if (!messageText) setInput('')
    setLoading(true)

    try {
      const response = await axios.post('/api/chatbot', { 
        message: textToSend,
        language: lastLanguage,
        sessionMemory: { ...sessionMemory, lastLanguage }
      })
      
      setMessages(prev => [...prev, { 
        role: 'bot', 
        content: response.data.response,
        ttsText: response.data.ttsText,
        soilResult: response.data.soilResult
      }])

      if (response.data.sessionMemory) {
        setSessionMemory(response.data.sessionMemory)
      }
    } catch (error) {
      console.error(error)
      const errReply = lastLanguage === 'Tamil' 
        ? 'மன்னித்துக் கொள்ளுங்கள், சேவையில் தற்காலிகத் தடை ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.'
        : 'Sorry, I encountered an issue. Please try again.'
      setMessages(prev => [...prev, { role: 'bot', content: errReply, ttsText: errReply }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 bg-primary-600 text-white p-4.5 rounded-full shadow-xl hover:bg-primary-700 hover:scale-105 transition-all z-50 flex items-center justify-center border border-primary-500/20"
          title="Open AI & Soil Assistant"
        >
          <MessageSquare className="w-6 h-6 text-white" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 w-96 sm:w-[420px] h-[550px] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border border-gray-200 overflow-hidden animate-slide-up">
          {/* Header */}
          <div className="bg-primary-600 text-white p-4 flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center">
              <Bot className="w-5 h-5 mr-2" />
              <div>
                <h3 className="font-extrabold text-sm leading-none">Smart Coop & Soil AI</h3>
                <span className="text-[10px] text-primary-100 font-medium">Agricultural Soil & Cooperative Help</span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Language Selector Header */}
              <div className="flex items-center bg-primary-700/90 rounded-lg px-2 py-1 text-[11px] font-bold border border-primary-500/30">
                <Globe className="w-3.5 h-3.5 mr-1 text-primary-200" />
                <select
                  value={lastLanguage}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="bg-transparent text-white outline-none cursor-pointer text-xs font-bold"
                  title="Select Chatbot Language"
                >
                  <option value="English" className="text-gray-900 font-medium">English</option>
                  <option value="Tamil" className="text-gray-900 font-medium">தமிழ்</option>
                </select>
              </div>

              <button onClick={() => setIsOpen(false)} className="hover:bg-primary-700 p-1 rounded-lg text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Voice Notification Banner */}
          {voiceNotice && (
            <div className="bg-amber-500 text-white text-[11px] font-bold px-3 py-1.5 flex items-center justify-between animate-pulse">
              <span className="flex items-center">
                <Mic className="w-3.5 h-3.5 mr-1.5" />
                {voiceNotice}
              </span>
            </div>
          )}

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
            {messages.map((msg, index) => {
              const isUser = msg.role === 'user'
              const isSpeaking = speakingIndex === index
              const hasSoilResult = Boolean(msg.soilResult && msg.soilResult.factors)

              return (
                <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex items-start space-x-2 max-w-[88%] ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
                    <div className={`p-1 rounded-lg border shrink-0 text-[10px] ${
                      isUser ? 'bg-primary-50 border-primary-100 text-primary-600' : 'bg-white border-gray-200 text-gray-400'
                    }`}>
                      {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5 text-primary-600" />}
                    </div>
                    
                    <div className="relative group flex items-end space-x-1">
                      <div className={`p-3 rounded-2xl text-xs leading-relaxed ${
                        isUser 
                          ? 'bg-primary-600 text-white rounded-tr-none shadow-xs' 
                          : 'bg-white text-gray-800 border border-gray-150 rounded-tl-none shadow-sm'
                      }`}>
                        {/* FEATURE 17: Fix duplicate rendering bug - show text bubble or clean card */}
                        {!hasSoilResult ? (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          /* FEATURE 18: Farmer-Friendly Card Layout (No Confidence %, No CatBoost Jargon) */
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center justify-between border-b border-gray-150 pb-2">
                              <div>
                                <h4 className="font-extrabold text-gray-900 text-xs">🌱 Soil & Crop Suitability</h4>
                                <p className="text-[11px] text-gray-600 font-medium">
                                  {msg.soilResult.crop} • {msg.soilResult.district || 'Salem'}
                                </p>
                              </div>
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                                msg.soilResult.prediction === 'Suitable' ? 'bg-emerald-100 text-emerald-800' :
                                msg.soilResult.prediction === 'Needs Improvement' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                              }`}>
                                {msg.soilResult.prediction === 'Suitable' ? (lastLanguage === 'Tamil' ? 'ஏற்றது' : 'Suitable') :
                                 msg.soilResult.prediction === 'Needs Improvement' ? (lastLanguage === 'Tamil' ? 'மேம்படுத்த வேண்டும்' : 'Needs Improvement') :
                                 (lastLanguage === 'Tamil' ? 'ஏற்றதல்ல' : 'Not Suitable')}
                              </span>
                            </div>

                            {/* Factor Breakdown */}
                            <div className="space-y-1 text-[11px] pt-1">
                              {Object.entries(msg.soilResult.factors).map(([key, f]) => {
                                const isGood = f.status === 'Suitable'
                                const isMod = f.status === 'Moderate'
                                const keyLabel = key.charAt(0).toUpperCase() + key.slice(1)

                                return (
                                  <div key={key} className="flex items-center justify-between py-0.5">
                                    <span className="text-gray-600 font-medium flex items-center">
                                      {isGood ? <CheckCircle2 className="w-3 h-3 text-emerald-500 mr-1.5" /> :
                                       isMod ? <Info className="w-3 h-3 text-amber-500 mr-1.5" /> :
                                       <AlertTriangle className="w-3 h-3 text-rose-500 mr-1.5" />}
                                      {keyLabel}
                                    </span>
                                    <span className={`font-bold ${
                                      isGood ? 'text-emerald-700' : isMod ? 'text-amber-700' : 'text-rose-700'
                                    }`}>
                                      {f.status}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>

                            {/* Suggestions */}
                            {msg.soilResult.suggestions && msg.soilResult.suggestions.length > 0 && (
                              <div className="border-t border-gray-150 pt-2 text-[11px] text-gray-700 space-y-1">
                                <p className="font-bold text-gray-800">What you can do:</p>
                                {msg.soilResult.suggestions.map((sug, sIdx) => (
                                  <p key={sIdx} className="leading-snug">• {sug.replace(/^•\s*/, '')}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* FEATURE 10 & 11: Speaker button speaks ONLY the clean answer text string */}
                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => speakMessage(msg, index)}
                          className={`p-1.5 rounded-full transition-all shrink-0 ${
                            isSpeaking 
                              ? 'bg-primary-600 text-white animate-pulse shadow-sm' 
                              : 'text-gray-400 hover:text-primary-600 hover:bg-white border border-transparent hover:border-gray-200'
                          }`}
                          title={isSpeaking ? 'Stop speaking' : `Read answer (${lastLanguage === 'Tamil' ? 'தமிழ்' : 'English'})`}
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-start space-x-2">
                  <div className="p-1 rounded-lg border bg-white text-gray-400">
                    <Bot className="w-3.5 h-3.5 text-primary-600 animate-spin" />
                  </div>
                  <div className="bg-white border border-gray-150 p-3 rounded-2xl rounded-tl-none shadow-sm">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-100"></div>
                      <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-200"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick suggestions */}
          <div className="p-2.5 bg-white border-t border-gray-100 space-y-1.5 shrink-0">
            <span className="text-[9px] text-gray-400 uppercase tracking-wider font-extrabold block px-0.5">Quick Questions</span>
            <div className="grid grid-cols-3 gap-1.5">
              {suggestions.map((sug, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(sug.question)}
                  disabled={loading}
                  className="p-1.5 bg-gray-50 border border-gray-200 hover:bg-primary-50 hover:border-primary-200 rounded-lg text-left text-[10px] font-bold text-gray-700 hover:text-primary-700 transition-all truncate"
                >
                  {sug.label}
                </button>
              ))}
            </div>
          </div>

          {/* Inputs & Voice Input Microphone Button */}
          <div className="p-3 bg-white border-t border-gray-100 flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={toggleListening}
              className={`p-2.5 rounded-xl transition-all border ${
                isListening 
                  ? 'bg-red-500 text-white border-red-600 animate-pulse shadow-md' 
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-primary-50 hover:text-primary-600'
              }`}
              title={isListening ? 'Stop Listening' : `Voice Input (${lastLanguage === 'Tamil' ? 'தமிழ் (ta-IN)' : 'English (en-IN)'})`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isListening ? `Listening... (Speaking in ${lastLanguage})` : `Ask in ${lastLanguage} or Tanglish...`}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none text-xs"
              disabled={loading}
            />
            
            <button
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              className="bg-primary-600 text-white p-2.5 rounded-xl hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default Chatbot
