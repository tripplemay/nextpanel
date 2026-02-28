import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  username: string;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (token, user) => {
        localStorage.setItem('access_token', token);
        set({ token, user });
      },
      logout: () => {
        localStorage.removeItem('access_token');
        set({ token: null, user: null });
      },
    }),
    { name: 'auth-store' },
  ),
);
