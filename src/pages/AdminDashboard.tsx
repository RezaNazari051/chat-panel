import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, Link as LinkIcon, MessageSquare, Settings, Search, CheckCircle, XCircle, Clock, Send, Ban, LogOut, Paperclip, FileText, Copy, Loader2, Trash2, EyeOff, Timer, Mic, Square, AlertTriangle, Moon, QrCode, Menu } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import { io, Socket } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns-jalali';
import { QRCodeCanvas } from 'qrcode.react';

interface Conversation {
  id: number;
  user_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  role: string;
  is_approved: number;
  is_banned: number;
  expires_at: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  duplicate_count: number;
  previous_name?: string;
}

interface Message {
  id: number;
  content: string;
  file_url?: string;
  sender_id: number;
  sender_role: string;
  created_at: string;
  is_read: number;
}

export default function AdminDashboard() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeTab, setActiveTab] = useState<'chats' | 'users' | 'invites' | 'settings'>('chats');
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userTyping, setUserTyping] = useState<Record<number, boolean>>({});
  const typingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Invite state
  const [inviteMinutes, setInviteMinutes] = useState<number | string>(60);
  const [inviteMaxUses, setInviteMaxUses] = useState<number | string>(1);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [generatedLink, setGeneratedLink] = useState('');

  // Message options
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [expiresInMinutes, setExpiresInMinutes] = useState<number | string>('');

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);

  // Mobile sidebar state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // QR Code state
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrContent, setQrContent] = useState('');
  const qrCanvasRef = React.useRef<HTMLCanvasElement>(null);

  const handleSendQR = async () => {
    if (!qrCanvasRef.current || !qrContent.trim() || !socket || !selectedConv) return;
    
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
            conversation_id: selectedConv.id,
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
            socket.emit('send_message', {
              conversation_id: selectedConv?.id,
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

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (user?.must_change_password) {
      setActiveTab('settings');
    }
  }, [user]);

  useEffect(() => {
    if (!token) return;

    fetchConversations();
    fetchInvites();

    const newSocket = io({
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Admin connected to chat');
    });

    newSocket.on('new_user_request', (data) => {
      fetchConversations();
      // Could show a toast notification here
    });

    newSocket.on('new_message_alert', ({ conversation_id, message }) => {
      if (selectedConv?.id === conversation_id) {
        setMessages(prev => [...prev, message]);
        // Mark as read immediately if active
        fetch(`/api/conversations/${conversation_id}/messages`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } else {
        fetchConversations();
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('پیام جدید', {
            body: 'شما یک پیام جدید دارید.',
            icon: '/vite.svg'
          });
        }
      }
    });

    newSocket.on('user_typing', ({ conversation_id, isTyping }) => {
      // Update typing indicator for specific conversation
    });

    newSocket.on('user_typing', ({ conversation_id, isTyping }) => {
      setUserTyping(prev => ({ ...prev, [conversation_id]: isTyping }));
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

    return () => {
      newSocket.close();
    };
  }, [token, selectedConv]);

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

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/admin/conversations', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setConversations(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchInvites = async () => {
    try {
      const res = await fetch('/api/admin/invites', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setInvites(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteInvite = async (inviteId: number) => {
    if (!confirm('آیا از حذف این لینک دعوت اطمینان دارید؟')) return;
    try {
      const res = await fetch(`/api/admin/invites/${inviteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setInvites(prev => prev.filter(i => i.id !== inviteId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeactivateInvite = async (inviteId: number) => {
    if (!confirm('آیا از مسدود کردن این لینک دعوت اطمینان دارید؟')) return;
    try {
      const res = await fetch(`/api/admin/invites/${inviteId}/deactivate`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchInvites();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyInvite = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(url);
    alert('لینک دعوت کپی شد');
  };

  const fetchMessages = async (convId: number) => {
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  const [showConfirmModal, setShowConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'warning';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'warning'
  });

  const handleSelectConv = (conv: Conversation) => {
    setSelectedConv(conv);
    fetchMessages(conv.id);
    socket?.emit('join_conversation', { conversation_id: conv.id });
    
    // Update unread count locally
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c));
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (!socket || !selectedConv) return;
    
    socket.emit('typing', { conversation_id: selectedConv.id, isTyping: true });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { conversation_id: selectedConv.id, isTyping: false });
    }, 2000);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedFile) || !socket || !selectedConv) return;

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
      conversation_id: selectedConv.id,
      content: newMessage,
      file_url: fileUrl,
      is_spoiler: isSpoiler,
      expires_in_minutes: expiresInMinutes
    });

    setNewMessage('');
    setIsSpoiler(false);
    setExpiresInMinutes('');
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socket.emit('typing', { conversation_id: selectedConv.id, isTyping: false });
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!confirm('آیا از حذف این پیام اطمینان دارید؟')) return;
    try {
      const res = await fetch(`/api/admin/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== messageId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearChat = async () => {
    if (!selectedConv) return;
    
    setShowConfirmModal({
      show: true,
      title: 'پاک کردن تاریخچه',
      message: 'آیا از پاک کردن کل تاریخچه چت این کاربر اطمینان دارید؟ این عمل قابل بازگشت نیست.',
      type: 'warning',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/conversations/${selectedConv.id}/messages`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            setMessages([]);
            setShowConfirmModal(prev => ({ ...prev, show: false }));
          }
        } catch (err) {
          console.error(err);
        }
      }
    });
  };

  const handleDeleteConversation = async () => {
    if (!selectedConv) return;

    setShowConfirmModal({
      show: true,
      title: 'حذف کامل گفتگو',
      message: 'آیا از حذف کامل این گفتگو و کاربر اطمینان دارید؟ این عمل غیرقابل بازگشت است و کاربر بلافاصله اخراج خواهد شد.',
      type: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/conversations/${selectedConv.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            setConversations(prev => prev.filter(c => c.id !== selectedConv.id));
            setSelectedConv(null);
            setMessages([]);
            setShowConfirmModal(prev => ({ ...prev, show: false }));
          }
        } catch (err) {
          console.error(err);
        }
      }
    });
  };

  // Create user state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [createUserError, setCreateUserError] = useState('');
  const [createUserSuccess, setCreateUserSuccess] = useState('');

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateUserError('');
    setCreateUserSuccess('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          first_name: newFirstName,
          last_name: newLastName,
          phone: newPhone
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCreateUserSuccess('کاربر با موفقیت ایجاد شد');
        setNewUsername('');
        setNewPassword('');
        setNewFirstName('');
        setNewLastName('');
        setNewPhone('');
        fetchConversations();
      } else {
        setCreateUserError(data.error || 'خطا در ایجاد کاربر');
      }
    } catch (err) {
      setCreateUserError('خطا در ارتباط با سرور');
    }
  };
  const [adminCurrentPassword, setAdminCurrentPassword] = useState('');
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [adminNewUsername, setAdminNewUsername] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState('');
  const [adminPasswordSuccess, setAdminPasswordSuccess] = useState('');

  const handleAdminChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/admin/users/${user?.id}/username`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username: adminNewUsername })
      });
      const data = await res.json();
      if (res.ok) {
        alert('نام کاربری با موفقیت تغییر کرد');
        setAdminNewUsername('');
      } else {
        alert(data.error || 'خطا در تغییر نام کاربری');
      }
    } catch (err) {
      console.error(err);
      alert('خطا در تغییر نام کاربری');
    }
  };

  const handleAdminChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPasswordError('');
    setAdminPasswordSuccess('');

    if (adminNewPassword !== adminConfirmPassword) {
      setAdminPasswordError('رمز عبور جدید و تکرار آن مطابقت ندارند');
      return;
    }

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: adminCurrentPassword,
          newPassword: adminNewPassword
        })
      });
      const data = await res.json();
      if (res.ok) {
        setAdminPasswordSuccess('رمز عبور با موفقیت تغییر کرد. لطفا دوباره وارد شوید.');
        setAdminCurrentPassword('');
        setAdminNewPassword('');
        setAdminConfirmPassword('');
        setTimeout(() => {
          logout();
          navigate('/login');
        }, 2000);
      } else {
        setAdminPasswordError(data.error || 'خطا در تغییر رمز عبور');
      }
    } catch (err) {
      setAdminPasswordError('خطا در ارتباط با سرور');
    }
  };

  const handleResetUserPassword = async (userId: number) => {
    const newPassword = prompt('لطفا رمز عبور جدید و موقت را برای این کاربر وارد کنید (حداقل ۸ کاراکتر، شامل عدد، و حرف بزرگ یا کاراکتر خاص):');
    if (!newPassword) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        alert('رمز عبور کاربر با موفقیت ریست شد. کاربر در ورود بعدی باید رمز خود را تغییر دهد.');
      } else {
        alert(data.error || 'خطا در ریست رمز عبور');
      }
    } catch (err) {
      alert('خطا در ارتباط با سرور');
    }
  };

  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ userId: number, minutes: number, conv: Conversation } | null>(null);

  const handleApprove = async (userId: number, minutes: number, loadHistory: boolean = false) => {
    const conv = conversations.find(c => c.user_id === userId);
    
    if (conv && conv.duplicate_count > 0 && !showDuplicateModal && !loadHistory) {
      setPendingApproval({ userId, minutes, conv });
      setShowDuplicateModal(true);
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${userId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          minutes, 
          load_history: loadHistory,
          clear_history: !loadHistory && conv?.duplicate_count ? true : false 
        })
      });
      if (res.ok) {
        fetchConversations();
        if (selectedConv?.user_id === userId) {
          setSelectedConv(prev => prev ? { ...prev, is_approved: 1 } : null);
          if (loadHistory) {
            fetchMessages(selectedConv.id);
          } else {
            setMessages([]);
          }
        }
        setShowDuplicateModal(false);
        setPendingApproval(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBan = async (userId: number, isBanned: boolean) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ is_banned: isBanned })
      });
      if (res.ok) {
        fetchConversations();
        if (selectedConv?.user_id === userId) {
          setSelectedConv(prev => prev ? { ...prev, is_banned: isBanned ? 1 : 0 } : null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const generateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGeneratingLink(true);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          minutes: Number(inviteMinutes) || 1, 
          max_uses: Number(inviteMaxUses) || 1 
        })
      });
      const data = await res.json();
      setGeneratedLink(data.url);
      fetchInvites();
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const filteredConversations = conversations.filter(c => 
    (c.first_name + ' ' + c.last_name).toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.phone && c.phone.includes(searchQuery))
  );

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden transition-colors duration-300">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 z-50">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">پنل مدیریت</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-gray-600 dark:text-gray-300">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <div className={`fixed md:static inset-y-0 right-0 z-40 w-64 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'} md:flex`}>
        <div className="hidden md:flex p-4 border-b border-gray-200 dark:border-gray-700 items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">پنل مدیریت</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={logout} className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="md:hidden p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between mt-16">
          <span className="font-medium text-gray-700 dark:text-gray-300">منو</span>
          <button onClick={logout} className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 flex items-center gap-2">
            <LogOut className="w-5 h-5" />
            <span>خروج</span>
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button
            onClick={() => !user?.must_change_password && setActiveTab('chats')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'chats' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'} ${user?.must_change_password ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={!!user?.must_change_password}
          >
            <MessageSquare className="w-5 h-5" />
            <span className="font-medium">گفتگوها</span>
          </button>
          <button
            onClick={() => !user?.must_change_password && setActiveTab('users')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'users' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'} ${user?.must_change_password ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={!!user?.must_change_password}
          >
            <Users className="w-5 h-5" />
            <span className="font-medium">کاربران</span>
          </button>
          <button
            onClick={() => !user?.must_change_password && setActiveTab('invites')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'invites' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'} ${user?.must_change_password ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={!!user?.must_change_password}
          >
            <LinkIcon className="w-5 h-5" />
            <span className="font-medium">لینک‌های دعوت</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'settings' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            <Settings className="w-5 h-5" />
            <span className="font-medium">تنظیمات</span>
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col pt-16 md:pt-0 w-full md:w-auto">
        {activeTab === 'chats' && (
          <div className="flex flex-1 overflow-hidden relative">
            {/* Chat List */}
            <div className={`w-full md:w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col transition-colors duration-300 absolute md:relative inset-0 z-20 ${selectedConv ? 'hidden md:flex' : 'flex'}`}>
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="relative">
                  <Search className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="جستجو..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-4 pr-10 py-2 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:bg-white dark:focus:bg-gray-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 transition-all text-sm text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredConversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => handleSelectConv(conv)}
                    className={`w-full text-right p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-start gap-3 ${selectedConv?.id === conv.id ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`}
                  >
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-lg">
                        {conv.first_name?.[0] || 'U'}
                      </div>
                      {conv.unread_count > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full border-2 border-white dark:border-gray-800">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{conv.first_name} {conv.last_name}</h3>
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap mr-2">
                          {conv.last_message_time ? format(new Date(conv.last_message_time), 'HH:mm') : ''}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{conv.last_message || 'بدون پیام'}</p>
                      {conv.role === 'temporary' && !conv.is_approved && (
                        <span className="inline-block mt-2 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 px-2 py-0.5 rounded-full">در انتظار تایید</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Area */}
            <div className={`flex-1 flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors duration-300 absolute md:relative inset-0 z-30 ${!selectedConv ? 'hidden md:flex' : 'flex'}`}>
              {selectedConv ? (
                <>
                  {/* Chat Header */}
                  <div className="bg-white dark:bg-gray-800 px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center shadow-sm z-10 transition-colors duration-300">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setSelectedConv(null)}
                        className="md:hidden p-2 text-gray-600 dark:text-gray-300"
                      >
                        <XCircle className="w-6 h-6" />
                      </button>
                      <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold">
                      {selectedConv.first_name?.[0] || 'U'}
                    </div>
                    <div>
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">{selectedConv.first_name} {selectedConv.last_name}</h2>
                      <p className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{selectedConv.phone}</p>
                    </div>
                  </div>
                    <div className="flex gap-2 items-center">
                      <ThemeToggle />
                      {selectedConv.role === 'temporary' && !selectedConv.is_approved && (
                        <button
                          onClick={() => handleApprove(selectedConv.user_id, 180)}
                          className="flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-green-200 dark:hover:bg-green-800/50 transition-colors"
                        >
                          <CheckCircle className="w-4 h-4" />
                          تایید دسترسی
                        </button>
                      )}
                      <button
                        onClick={handleClearChat}
                        className="flex items-center gap-1 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-orange-100 dark:hover:bg-orange-800/50 transition-colors"
                        title="پاک کردن کل چت"
                      >
                        <Trash2 className="w-4 h-4" />
                        پاک کردن چت
                      </button>
                      <button
                        onClick={handleDeleteConversation}
                        className="flex items-center gap-1 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-800/50 transition-colors"
                        title="حذف کامل گفتگو"
                      >
                        <XCircle className="w-4 h-4" />
                        حذف گفتگو
                      </button>
                      <button
                        onClick={() => handleBan(selectedConv.user_id, !selectedConv.is_banned)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedConv.is_banned ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/50'}`}
                      >
                        <Ban className="w-4 h-4" />
                        {selectedConv.is_banned ? 'رفع مسدودی' : 'مسدود کردن'}
                      </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {messages.map((msg) => {
                    const isMine = msg.sender_role === 'admin';
                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-start' : 'justify-end'} group`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2 relative ${isMine ? 'bg-indigo-600 dark:bg-indigo-500 text-white rounded-tr-sm' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm rounded-tl-sm border border-gray-100 dark:border-gray-700'}`}>
                          {isMine && (
                            <button 
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="absolute -left-8 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="حذف پیام"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {!isMine && (
                            <button 
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="absolute -right-8 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="حذف پیام"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {msg.is_spoiler === 1 && (
                            <div className="flex items-center gap-2 mb-1 text-xs opacity-70">
                              <EyeOff className="w-3 h-3" />
                              <span>اسپویلر</span>
                            </div>
                          )}
                          {msg.expires_at && (
                            <div className="flex items-center gap-2 mb-1 text-xs opacity-70">
                              <Timer className="w-3 h-3" />
                              <span>حذف خودکار</span>
                            </div>
                          )}
                          {msg.file_url && (
                            <div className="mb-2">
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
                          {msg.content && <p className="text-sm leading-relaxed">{msg.content}</p>}
                          <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${isMine ? 'text-indigo-200' : 'text-gray-400'}`}>
                            <span>{format(new Date(msg.created_at), 'HH:mm')}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {userTyping[selectedConv.id] && (
                    <div className="flex justify-end">
                      <div className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm rounded-2xl rounded-tl-sm border border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center gap-1">
                        <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input */}
                <div className="bg-white dark:bg-gray-800 p-4 border-t border-gray-200 dark:border-gray-700 transition-colors duration-300">
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
                      disabled={selectedConv.is_banned === 1 || (selectedConv.role === 'temporary' && !selectedConv.is_approved)}
                      className="p-3 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-colors disabled:opacity-50"
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
                      disabled={isRecording || selectedConv.is_banned === 1 || (selectedConv.role === 'temporary' && !selectedConv.is_approved)}
                      className="flex-1 bg-gray-100 dark:bg-gray-700 border-transparent focus:bg-white dark:focus:bg-gray-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 rounded-xl px-4 py-3 text-sm transition-all disabled:opacity-50 text-gray-900 dark:text-gray-100"
                    />
                    {newMessage.trim() || selectedFile ? (
                      <button
                        type="submit"
                        disabled={(!newMessage.trim() && !selectedFile) || isUploading || selectedConv.is_banned === 1 || (selectedConv.role === 'temporary' && !selectedConv.is_approved)}
                        className="bg-indigo-600 text-white p-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Send className="w-5 h-5 rtl:rotate-180" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={selectedConv.is_banned === 1 || (selectedConv.role === 'temporary' && !selectedConv.is_approved)}
                        className={`p-3 rounded-xl transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'}`}
                      >
                        {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      </button>
                    )}
                  </form>
                </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-400 flex-col gap-4 transition-colors duration-300">
                  <MessageSquare className="w-16 h-16 opacity-20" />
                  <p>یک گفتگو را برای شروع انتخاب کنید</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'invites' && (
          <div className="flex-1 overflow-y-auto p-8 bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
            <div className="max-w-3xl mx-auto">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8 transition-colors duration-300">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6">ایجاد لینک دعوت جدید</h2>
                <form onSubmit={generateInvite} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">مدت اعتبار (دقیقه)</label>
                    <input
                      type="number"
                      min="1"
                      value={inviteMinutes}
                      onChange={(e) => setInviteMinutes(e.target.value === '' ? '' : parseInt(e.target.value))}
                      className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">حداکثر تعداد استفاده</label>
                    <input
                      type="number"
                      min="1"
                      value={inviteMaxUses}
                      onChange={(e) => setInviteMaxUses(e.target.value === '' ? '' : parseInt(e.target.value))}
                      className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      disabled={isGeneratingLink}
                      className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {isGeneratingLink ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          در حال تولید...
                        </>
                      ) : (
                        'تولید لینک'
                      )}
                    </button>
                  </div>
                </form>

                {generatedLink && (
                  <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl flex items-center justify-between">
                    <code className="text-green-800 dark:text-green-400 text-sm" dir="ltr">{generatedLink}</code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedLink);
                        // Optional: show a toast or change icon briefly
                      }}
                      className="text-green-700 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 p-2 hover:bg-green-100 dark:hover:bg-green-900/50 rounded-lg transition-colors"
                      title="کپی لینک"
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors duration-300">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">توکن</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">استفاده شده</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">تاریخ ایجاد</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">وضعیت</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {invites.map((invite) => (
                      <tr key={invite.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100" dir="ltr">{invite.token}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{invite.current_uses} / {invite.max_uses}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{format(new Date(invite.created_at), 'yyyy/MM/dd HH:mm')}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {invite.expires_at && new Date(invite.expires_at) < new Date() ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400">منقضی شده</span>
                          ) : (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">فعال</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3 space-x-reverse">
                          <button
                            onClick={() => handleCopyInvite(invite.token)}
                            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300"
                            title="کپی لینک"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeactivateInvite(invite.id)}
                            className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300"
                            title="مسدود کردن"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteInvite(invite.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                            title="حذف لینک"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="flex-1 overflow-y-auto p-8 bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
            <div className="max-w-5xl mx-auto space-y-8">
              {/* Create User Form */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors duration-300">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6">ایجاد کاربر جدید (ثبت نام شده)</h2>
                {createUserError && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm">{createUserError}</div>}
                {createUserSuccess && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-xl text-sm">{createUserSuccess}</div>}
                <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">نام کاربری</label>
                    <input type="text" required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">رمز عبور</label>
                    <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">نام</label>
                    <input type="text" required value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">نام خانوادگی</label>
                    <input type="text" required value={newLastName} onChange={(e) => setNewLastName(e.target.value)} className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">شماره موبایل</label>
                    <input type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" className="w-full py-2 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
                      ایجاد کاربر
                    </button>
                  </div>
                </form>
              </div>

              {/* Users List */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors duration-300">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">نام و نام خانوادگی</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">شماره موبایل</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">نوع کاربری</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">وضعیت</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">عملیات</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {conversations.map((conv) => (
                    <tr key={conv.user_id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold">
                            {conv.first_name?.[0] || 'U'}
                          </div>
                          <div className="mr-4">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{conv.first_name} {conv.last_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" dir="ltr">{conv.phone}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${conv.role === 'temporary' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400'}`}>
                          {conv.role === 'temporary' ? 'موقت' : 'ثبت نام شده'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {conv.is_banned ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400">مسدود</span>
                        ) : conv.role === 'temporary' && !conv.is_approved ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-400">در انتظار تایید</span>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">فعال</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-4 space-x-reverse">
                        <button
                          onClick={() => handleBan(conv.user_id, !conv.is_banned)}
                          className={`text-${conv.is_banned ? 'green' : 'red'}-600 dark:text-${conv.is_banned ? 'green' : 'red'}-400 hover:text-${conv.is_banned ? 'green' : 'red'}-900 dark:hover:text-${conv.is_banned ? 'green' : 'red'}-300`}
                        >
                          {conv.is_banned ? 'رفع مسدودی' : 'مسدود کردن'}
                        </button>
                        <button
                          onClick={() => handleResetUserPassword(conv.user_id)}
                          className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300"
                        >
                          ریست رمز عبور
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
          <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 transition-colors duration-300">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
              {user?.must_change_password ? 'تغییر اجباری رمز عبور' : 'تنظیمات حساب کاربری'}
            </h2>

            {!user?.must_change_password && (
              <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-700/50 rounded-2xl border border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">ظاهر برنامه</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg text-indigo-600 dark:text-indigo-400">
                      <Moon className="w-5 h-5" />
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

            {!!user?.must_change_password && (
              <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-xl text-yellow-800 dark:text-yellow-400 text-sm">
                لطفا قبل از ادامه، رمز عبور جدیدی برای خود تنظیم کنید.
              </div>
            )}
            
            {adminPasswordError && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3 text-red-700 dark:text-red-400">
                <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{adminPasswordError}</p>
              </div>
            )}

            {adminPasswordSuccess && (
              <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl flex items-start gap-3 text-green-700 dark:text-green-400">
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{adminPasswordSuccess}</p>
              </div>
            )}

            <form onSubmit={handleAdminChangePassword} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">رمز عبور فعلی</label>
                <input
                  type="password"
                  required
                  value={adminCurrentPassword}
                  onChange={(e) => setAdminCurrentPassword(e.target.value)}
                  className="block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">رمز عبور جدید</label>
                <input
                  type="password"
                  required
                  value={adminNewPassword}
                  onChange={(e) => setAdminNewPassword(e.target.value)}
                  className="block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="حداقل ۸ کاراکتر، شامل عدد، و حرف بزرگ یا کاراکتر خاص"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">تکرار رمز عبور جدید</label>
                <input
                  type="password"
                  required
                  value={adminConfirmPassword}
                  onChange={(e) => setAdminConfirmPassword(e.target.value)}
                  className="block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                تغییر رمز عبور
              </button>
            </form>

            <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">تغییر نام کاربری</h3>
              <form onSubmit={handleAdminChangeUsername} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">نام کاربری جدید</label>
                  <input
                    type="text"
                    required
                    value={adminNewUsername}
                    onChange={(e) => setAdminNewUsername(e.target.value)}
                    className="block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                >
                  تغییر نام کاربری
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
      </div>
      {/* Duplicate User Modal */}
      {showDuplicateModal && pendingApproval && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700 transition-colors duration-300">
            <div className="flex items-center gap-3 text-yellow-600 dark:text-yellow-400 mb-4">
              <Clock className="w-6 h-6" />
              <h3 className="text-xl font-bold">کاربر تکراری شناسایی شد</h3>
            </div>
            
            <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              این شماره تلفن (<span dir="ltr">{pendingApproval.conv.phone}</span>) قبلاً در سیستم ثبت شده است. 
              لطفاً اطلاعات زیر را بررسی کرده و نوع دسترسی را انتخاب کنید:
            </p>

            <div className="space-y-4 mb-8">
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-100 dark:border-gray-600">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">نام ثبت شده قبلی:</p>
                <p className="font-semibold text-gray-800 dark:text-gray-200">{pendingApproval.conv.previous_name || 'نامشخص'}</p>
              </div>
              <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl border border-indigo-100 dark:border-indigo-800">
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-1">نام جدید در این درخواست:</p>
                <p className="font-semibold text-indigo-800 dark:text-indigo-200">{pendingApproval.conv.first_name} {pendingApproval.conv.last_name}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => handleApprove(pendingApproval.userId, pendingApproval.minutes, true)}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <MessageSquare className="w-5 h-5" />
                بارگذاری تاریخچه قبلی
              </button>
              <button
                onClick={() => handleApprove(pendingApproval.userId, pendingApproval.minutes, false)}
                className="w-full py-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                شروع چت تازه (حذف تاریخچه)
              </button>
              <button
                onClick={() => {
                  setShowDuplicateModal(false);
                  setPendingApproval(null);
                }}
                className="w-full py-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors text-sm"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal.show && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700 transition-colors duration-300">
            <div className={`flex items-center gap-3 mb-4 ${showConfirmModal.type === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-xl font-bold">{showConfirmModal.title}</h3>
            </div>
            
            <p className="text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
              {showConfirmModal.message}
            </p>

            <div className="flex gap-3">
              <button
                onClick={showConfirmModal.onConfirm}
                className={`flex-1 py-3 rounded-xl font-medium text-white transition-colors ${showConfirmModal.type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
              >
                تایید و ادامه
              </button>
              <button
                onClick={() => setShowConfirmModal(prev => ({ ...prev, show: false }))}
                className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                انصراف
              </button>
            </div>
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
