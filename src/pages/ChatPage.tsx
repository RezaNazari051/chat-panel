import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { io, Socket } from 'socket.io-client';
import { Send, Clock, LogOut, Check, CheckCheck, Paperclip, FileText, XCircle, Settings, CheckCircle, LayoutDashboard, EyeOff, Timer, Mic, Square, Moon, QrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns-jalali';
import ThemeToggle from '../components/ThemeToggle';
import { QRCodeCanvas } from 'qrcode.react';

interface Message {
  id: number;
  content: string;
  file_url?: string;
  sender_id: number;
  sender_role: string;
  created_at: string;
  is_read: number;
  is_spoiler?: number;
  expires_at?: string;
}

export default function ChatPage() {
  const { user, token, logout } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [adminTyping, setAdminTyping] = useState(false);
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [expiresInMinutes, setExpiresInMinutes] = useState<number | string>('');
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<number, boolean>>({});

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // QR Code state
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrContent, setQrContent] = useState('');
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const handleSendQR = async () => {
    if (!qrCanvasRef.current || !qrContent.trim() || !socket || !conversationId) return;
    
    const canvas = qrCanvasRef.current;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], 'qrcode.png', { type: 'image/png' });
      
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        const data = await res.json();
        if (data.url) {
          socket.emit('send_message', {
            conversation_id: conversationId,
            content: 'کد QR',
            file_url: data.url,
            is_spoiler: isSpoiler,
            expires_in_minutes: expiresInMinutes
          });
          setShowQRModal(false);
          setQrContent('');
        }
      } catch (error) {
        console.error('QR upload failed:', error);
      }
      setIsUploading(false);
    });
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('مرورگر شما از قابلیت ضبط صدا پشتیبانی نمی‌کند یا دسترسی در این محیط محدود شده است.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([audioBlob], 'voice_message.webm', { type: 'audio/webm' });
        
        // Upload and send
        const formData = new FormData();
        formData.append('file', file);
        
        try {
          setIsUploading(true);
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
          });
          const data = await res.json();
          if (res.ok) {
            socket?.emit('send_message', {
              content: '',
              file_url: data.file_url,
              is_spoiler: isSpoiler,
              expires_in_minutes: expiresInMinutes
            });
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsUploading(false);
        }

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error('Error accessing microphone:', err);
      let msg = 'خطا در دسترسی به میکروفون';
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'میکروفون یافت نشد. لطفا از اتصال فیزیکی میکروفون به دستگاه خود اطمینان حاصل کنید.';
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'دسترسی به میکروفون توسط شما یا مرورگر مسدود شده است. لطفا در تنظیمات آدرس‌بار (قفل کنار آدرس) اجازه دسترسی را فعال کنید.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'میکروفون توسط برنامه دیگری در حال استفاده است.';
      } else {
        msg = 'خطا در دسترسی به میکروفون: ' + (err.message || err.name || 'خطای ناشناخته');
      }
      alert(msg);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Basic copy/screenshot prevention
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      alert('کپی کردن پیام‌ها مجاز نیست.');
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        navigator.clipboard.writeText('');
        alert('گرفتن اسکرین‌شات مجاز نیست.');
      }
    };

    document.addEventListener('copy', handleCopy);
    window.addEventListener('keyup', handleKeyDown);

    return () => {
      document.removeEventListener('copy', handleCopy);
      window.removeEventListener('keyup', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!token || !user) return;

    const newSocket = io({
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Connected to chat');
    });

    newSocket.on('new_message', (message: Message) => {
      setMessages(prev => [...prev, message]);
      setAdminTyping(false);
      if (message.sender_id !== user.id && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('پشتیبانی', {
          body: 'پشتیبانی یک پیام جدید ارسال کرد.',
          icon: '/vite.svg'
        });
      }
    });

    newSocket.on('admin_typing', ({ isTyping }) => {
      setAdminTyping(isTyping);
    });

    newSocket.on('error', (error: { message: string }) => {
      alert(error.message);
    });

    newSocket.on('user_banned', () => {
      alert('دسترسی شما مسدود شد.');
      logout();
      navigate('/login');
    });

    newSocket.on('force_logout', () => {
      alert('نشست شما منقضی شد. لطفا دوباره وارد شوید.');
      logout();
      navigate('/login');
    });

    newSocket.on('message_deleted', ({ messageId }) => {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    });

    newSocket.on('chat_cleared', () => {
      setMessages([]);
    });

    setSocket(newSocket);

    // Fetch initial messages
    fetchMessages();

    return () => {
      newSocket.close();
    };
  }, [token, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, adminTyping]);

  useEffect(() => {
    if (user?.role === 'temporary') {
      const checkTime = async () => {
        try {
          const res = await fetch(`/api/auth/status/${user.username}`);
          const data = await res.json();
          if (data.user?.expires_at) {
            const updateTimer = () => {
              const now = new Date().getTime();
              const expire = new Date(data.user.expires_at).getTime();
              const distance = expire - now;

              if (distance < 0) {
                setTimeLeft('پایان یافته');
                logout();
                navigate('/login');
                return;
              }

              const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
              const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
              const seconds = Math.floor((distance % (1000 * 60)) / 1000);
              setTimeLeft(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            };
            updateTimer();
            const interval = setInterval(updateTimer, 1000);
            return () => clearInterval(interval);
          }
        } catch (err) {
          console.error(err);
        }
      };
      checkTime();
    }
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime();
      setMessages(prev => {
        const filtered = prev.filter(m => {
          if (!m.expires_at) return true;
          return new Date(m.expires_at).getTime() > now;
        });
        if (filtered.length !== prev.length) return filtered;
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchMessages = async () => {
    try {
      const res = await fetch('/api/user/conversation', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.status === 401) {
        logout();
        navigate('/login');
        return;
      }

      const data = await res.json();
      if (data.id) {
        const msgRes = await fetch(`/api/conversations/${data.id}/messages`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (msgRes.status === 401) {
          logout();
          navigate('/login');
          return;
        }

        const msgs = await msgRes.json();
        setMessages(msgs);
        // Save conv id to state
        setConversationId(data.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const [conversationId, setConversationId] = useState<number | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user?.must_change_password) {
      setShowSettings(true);
      return;
    }
    if ((!newMessage.trim() && !selectedFile) || !socket || !conversationId) return;

    let fileUrl = null;
    if (selectedFile) {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        const data = await res.json();
        if (data.url) {
          fileUrl = data.url;
        }
      } catch (error) {
        console.error('File upload failed:', error);
      }
      setIsUploading(false);
      setSelectedFile(null);
    }

    socket.emit('send_message', {
      conversation_id: conversationId,
      content: newMessage,
      file_url: fileUrl,
      is_spoiler: isSpoiler,
      expires_in_minutes: expiresInMinutes
    });

    setNewMessage('');
    setIsSpoiler(false);
    setExpiresInMinutes('');
    socket.emit('typing', { conversation_id: conversationId, isTyping: false });
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (!socket || !conversationId) return;
    
    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing', { conversation_id: conversationId, isTyping: true });
    }

    // Debounce typing false
    setTimeout(() => {
      setIsTyping(false);
      socket.emit('typing', { conversation_id: conversationId, isTyping: false });
    }, 2000);
  };

  const [showSettings, setShowSettings] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  useEffect(() => {
    if (user?.must_change_password) {
      if (user.role === 'admin') {
        navigate('/admin');
      } else {
        setShowSettings(true);
      }
    }
  }, [user]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('رمز عبور جدید و تکرار آن مطابقت ندارند');
      return;
    }

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordSuccess('رمز عبور با موفقیت تغییر کرد');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        
        // Update user context to remove must_change_password
        if (user) {
          const updatedUser = { ...user, must_change_password: 0 };
          localStorage.setItem('user', JSON.stringify(updatedUser));
          // Note: A full context update would be better, but this works for local state
          // Alternatively, force a logout to get a fresh token with new token_version
          setTimeout(() => {
            alert('لطفا با رمز عبور جدید وارد شوید.');
            logout();
            navigate('/login');
          }, 2000);
        }
      } else {
        setPasswordError(data.error || 'خطا در تغییر رمز عبور');
      }
    } catch (err) {
      setPasswordError('خطا در ارتباط با سرور');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 select-none transition-colors duration-300">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm px-6 py-4 flex justify-between items-center z-10 border-b border-gray-200 dark:border-gray-700 transition-colors duration-300">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold">
            م
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">پشتیبانی</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">پاسخگویی آنلاین</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <ThemeToggle />
          {user?.role === 'admin' && (
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-full text-sm font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
              title="پنل مدیریت"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>پنل مدیریت</span>
            </button>
          )}
          {user?.role === 'registered' && (
            <button
              onClick={() => setShowSettings(true)}
              className="text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              title="تنظیمات"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
          {timeLeft && (
            <div className="flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-3 py-1.5 rounded-full text-sm font-medium">
              <Clock className="w-4 h-4" />
              <span dir="ltr">{timeLeft}</span>
            </div>
          )}
          <button onClick={handleLogout} className="p-2 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/30">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-center my-4">
          <span className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs px-3 py-1 rounded-full">
            شروع گفتگو
          </span>
        </div>

        {messages.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          const isSpoiler = msg.is_spoiler === 1;
          const isRevealed = revealedSpoilers[msg.id];

          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${isMine ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm rounded-tl-sm border border-gray-100 dark:border-gray-700'}`}>
                {msg.expires_at && (
                  <div className="flex items-center gap-1 mb-1 text-[10px] opacity-70">
                    <Timer className="w-3 h-3" />
                    <span>حذف خودکار</span>
                  </div>
                )}
                {msg.file_url && (
                  <div className={`mb-2 ${isSpoiler && !isRevealed ? 'blur-md cursor-pointer' : ''}`} onClick={() => isSpoiler && setRevealedSpoilers(prev => ({ ...prev, [msg.id]: true }))}>
                    {msg.file_url.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                      <img src={msg.file_url} alt="Attachment" className="max-w-full rounded-lg max-h-64 object-cover" />
                    ) : msg.file_url.match(/\.(webm|mp3|wav|ogg|m4a)$/i) ? (
                      <audio src={msg.file_url} controls className="max-w-full" />
                    ) : (
                      <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 p-2 rounded-lg ${isMine ? 'bg-indigo-700 hover:bg-indigo-800' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'} transition-colors`}>
                        <FileText className="w-5 h-5" />
                        <span className="text-sm truncate">فایل پیوست</span>
                      </a>
                    )}
                  </div>
                )}
                {msg.content && (
                  <div 
                    className={`relative ${isSpoiler && !isRevealed ? 'cursor-pointer' : ''}`}
                    onClick={() => isSpoiler && setRevealedSpoilers(prev => ({ ...prev, [msg.id]: true }))}
                  >
                    {isSpoiler && !isRevealed ? (
                      <div className="flex items-center gap-2 bg-black/10 dark:bg-white/10 px-3 py-2 rounded-lg backdrop-blur-sm">
                        <EyeOff className="w-4 h-4" />
                        <span className="text-xs">برای مشاهده کلیک کنید (اسپویلر)</span>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    )}
                  </div>
                )}
                <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${isMine ? 'text-indigo-200' : 'text-gray-400 dark:text-gray-500'}`}>
                  <span>{format(new Date(msg.created_at), 'HH:mm')}</span>
                  {isMine && (
                    msg.is_read ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        
        {adminTyping && (
          <div className="flex justify-end">
            <div className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1 border border-gray-100 dark:border-gray-700">
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-white dark:bg-gray-800 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.3)] z-10 border-t border-gray-200 dark:border-gray-700 transition-colors duration-300">
        <div className="max-w-4xl mx-auto">
          {selectedFile && (
            <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300 truncate">{selectedFile.name}</span>
              <button onClick={() => setSelectedFile(null)} className="text-red-500 hover:text-red-700">
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-4 mb-3">
            <button
              type="button"
              onClick={() => setIsSpoiler(!isSpoiler)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isSpoiler ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              <EyeOff className="w-4 h-4" />
              اسپویلر
            </button>
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-gray-400" />
              <select
                value={expiresInMinutes}
                onChange={(e) => setExpiresInMinutes(e.target.value)}
                className="text-xs bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg px-2 py-1.5 focus:ring-0 focus:border-indigo-500 text-gray-900 dark:text-gray-100"
              >
                <option value="">بدون زمان‌سنج</option>
                <option value="1">۱ دقیقه</option>
                <option value="5">۵ دقیقه</option>
                <option value="15">۱۵ دقیقه</option>
                <option value="60">۱ ساعت</option>
                <option value="1440">۲۴ ساعت</option>
              </select>
            </div>
          </div>
          <form onSubmit={handleSend} className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-full transition-colors flex-shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setShowQRModal(true)}
              className="p-3 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-full transition-colors flex-shrink-0"
              title="ساخت کد QR"
            >
              <QrCode className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={handleTyping}
              placeholder={isRecording ? "در حال ضبط صدا..." : "پیام خود را بنویسید..."}
              disabled={isRecording}
              className="flex-1 bg-gray-100 dark:bg-gray-700 border-transparent focus:bg-white dark:focus:bg-gray-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 rounded-full px-6 py-3 text-sm transition-all text-gray-900 dark:text-gray-100"
            />
            {newMessage.trim() || selectedFile ? (
              <button
                type="submit"
                disabled={(!newMessage.trim() && !selectedFile) || isUploading}
                className="bg-indigo-600 text-white p-3 rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                <Send className="w-5 h-5 rtl:rotate-180" />
              </button>
            ) : (
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                className={`p-3 rounded-full transition-colors flex-shrink-0 ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'}`}
              >
                {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            )}
          </form>
        </div>
      </div>
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700 transition-colors duration-300">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
              {user?.must_change_password ? 'تغییر اجباری رمز عبور' : 'تنظیمات حساب کاربری'}
            </h2>

            {!user?.must_change_password && (
              <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-700/50 rounded-2xl border border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">ظاهر برنامه</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg text-indigo-600 dark:text-indigo-400">
                      <EyeOff className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">حالت شب</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">تغییر تم برنامه به حالت تیره یا روشن</p>
                    </div>
                  </div>
                  <ThemeToggle className="scale-125" />
                </div>
              </div>
            )}

            {user?.must_change_password && (
              <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-xl text-yellow-800 dark:text-yellow-400 text-sm">
                مدیر سیستم رمز عبور شما را ریست کرده است. لطفا قبل از ادامه، رمز عبور جدیدی برای خود تنظیم کنید.
              </div>
            )}

            {passwordError && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3 text-red-700 dark:text-red-400">
                <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{passwordError}</p>
              </div>
            )}

            {passwordSuccess && (
              <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl flex items-start gap-3 text-green-700 dark:text-green-400">
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{passwordSuccess}</p>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">رمز عبور فعلی</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">رمز عبور جدید</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="حداقل ۸ کاراکتر، شامل عدد، و حرف بزرگ یا کاراکتر خاص"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">تکرار رمز عبور جدید</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="flex-1 py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                >
                  تغییر رمز عبور
                </button>
                {!user?.must_change_password && (
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="flex-1 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    انصراف
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
      {/* QR Code Modal */}
      {showQRModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden transition-colors duration-300">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">ساخت کد QR</h2>
              <button onClick={() => setShowQRModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">متن یا لینک</label>
                <input
                  type="text"
                  value={qrContent}
                  onChange={(e) => setQrContent(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  placeholder="https://example.com"
                />
              </div>
              <div className="flex justify-center p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
                {qrContent ? (
                  <QRCodeCanvas
                    value={qrContent}
                    size={200}
                    level="M"
                    includeMargin={true}
                    ref={qrCanvasRef}
                  />
                ) : (
                  <div className="w-[200px] h-[200px] flex items-center justify-center text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl">
                    <QrCode className="w-12 h-12 opacity-50" />
                  </div>
                )}
              </div>
              <button
                onClick={handleSendQR}
                disabled={!qrContent.trim() || isUploading}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
              >
                {isUploading ? <span className="animate-spin">⏳</span> : <Send className="w-5 h-5" />}
                ارسال به عنوان پیام
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
