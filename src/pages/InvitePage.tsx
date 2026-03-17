import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User, Phone, Clock, CheckCircle, XCircle } from 'lucide-react';

export default function InvitePage() {
  const { token } = useParams();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'form' | 'pending' | 'approved' | 'banned'>('form');
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const { login, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const savedUsername = localStorage.getItem('temp_username');
    const savedToken = localStorage.getItem('temp_invite_token');

    // If visiting an invite link, and it's different from the one that created the current session,
    // we MUST clear everything to ensure isolation and force a new registration.
    if (token && token !== savedToken) {
      localStorage.removeItem('temp_username');
      localStorage.removeItem('temp_invite_token');
      logout(); // Clear AuthContext and localStorage 'token'/'user'
      setStatus('form');
      return;
    }

    if (savedUsername) {
      setUsername(savedUsername);
      checkStatus(savedUsername);
      
      const interval = setInterval(() => {
        checkStatus(savedUsername);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [token, logout]);

  const checkStatus = async (uname: string) => {
    try {
      const res = await fetch(`/api/auth/status/${uname}`);
      const data = await res.json();
      if (res.ok) {
        if (data.status === 'approved' && data.token) {
          login(data.token, data.user);
          navigate('/chat');
        } else if (data.status === 'expired') {
          localStorage.removeItem('temp_username');
          localStorage.removeItem('temp_invite_token');
          logout();
          setStatus('form');
        } else {
          setStatus(data.status);
        }
      } else if (res.status === 404) {
        localStorage.removeItem('temp_username');
        localStorage.removeItem('temp_invite_token');
        logout();
        setStatus('form');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('لینک دعوت معتبر نیست (توکن یافت نشد)');
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/auth/register-temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, first_name: firstName, last_name: lastName, phone })
      });
      
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        console.error('Non-JSON response:', text);
        throw new Error('پاسخ نامعتبر از سرور دریافت شد. لطفا دوباره تلاش کنید.');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطا در ثبت درخواست');
      
      setUsername(data.username);
      localStorage.setItem('temp_username', data.username);
      if (token) {
        localStorage.setItem('temp_invite_token', token);
      }
      setStatus('pending');
      
      // Start polling
      const interval = setInterval(() => {
        checkStatus(data.username);
      }, 5000);
      return () => clearInterval(interval);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (status === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <Clock className="w-16 h-16 text-yellow-500 mx-auto mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">درخواست شما ثبت شد</h2>
          <p className="text-gray-600">لطفا منتظر تایید مدیر بمانید. این صفحه به صورت خودکار بروزرسانی می‌شود.</p>
        </div>
      </div>
    );
  }

  if (status === 'banned') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">دسترسی مسدود شد</h2>
          <p className="text-gray-600">درخواست شما توسط مدیر رد شده است یا دسترسی شما مسدود شده است.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">شروع گفتگو</h2>
          <p className="text-gray-500 mt-2">لطفا اطلاعات خود را برای شروع گفتگو وارد کنید</p>
        </div>
        
        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">نام</label>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="نام"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">نام خانوادگی</label>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="نام خانوادگی"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">شماره موبایل</label>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Phone className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  if (val.length <= 11) setPhone(val);
                }}
                className="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 text-left"
                placeholder="09123456789"
                dir="ltr"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            ثبت درخواست
          </button>
        </form>
      </div>
    </div>
  );
}
