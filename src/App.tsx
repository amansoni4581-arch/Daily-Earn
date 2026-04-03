/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  serverTimestamp, 
  Timestamp,
  addDoc,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { 
  Wallet, 
  Gift, 
  Users, 
  History, 
  LogOut, 
  PlusCircle, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  ArrowRight,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  balance: number;
  referralCode: string;
  referredBy?: string;
  createdAt: Timestamp;
}

interface Task {
  id: string;
  title: string;
  reward: number;
  description?: string;
}

interface Transaction {
  id: string;
  uid: string;
  amount: number;
  type: 'task' | 'referral' | 'withdrawal';
  description: string;
  createdAt: Timestamp;
}

interface Withdrawal {
  id: string;
  uid: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  paymentMethod: string;
  paymentDetails: string;
  createdAt: Timestamp;
}

// --- Error Handling ---

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Context ---

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isNewUser: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  applyReferral: (code: string) => Promise<void>;
  skipReferral: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within a FirebaseProvider');
  return context;
};

// --- Components ---

const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            // New user setup
            const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const newProfile: Partial<UserProfile> = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'User',
              email: firebaseUser.email || '',
              photoURL: firebaseUser.photoURL || '',
              balance: 0,
              referralCode,
              createdAt: Timestamp.now()
            };
            setDoc(userDocRef, newProfile).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${firebaseUser.uid}`));
            setIsNewUser(true);
          }
        }, (error) => handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`));
      } else {
        setProfile(null);
        setIsNewUser(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const [isNewUser, setIsNewUser] = useState(false);

  const signIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const applyReferral = async (code: string) => {
    if (!user || !profile) return;
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('referralCode', '==', code.toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const referrerDoc = querySnapshot.docs[0];
        const referrerData = referrerDoc.data() as UserProfile;

        // Update current user
        await updateDoc(doc(db, 'users', user.uid), {
          referredBy: code.toUpperCase(),
          balance: 50 // Welcome bonus
        });

        // Update referrer
        await updateDoc(doc(db, 'users', referrerDoc.id), {
          balance: referrerData.balance + 50
        });

        // Add transactions
        await addDoc(collection(db, 'transactions'), {
          uid: user.uid,
          amount: 50,
          type: 'referral',
          description: `Referral bonus (from ${referrerData.displayName})`,
          createdAt: serverTimestamp()
        });

        await addDoc(collection(db, 'transactions'), {
          uid: referrerDoc.id,
          amount: 50,
          type: 'referral',
          description: `Referral bonus (for inviting ${profile.displayName})`,
          createdAt: serverTimestamp()
        });

        setIsNewUser(false);
      } else {
        alert('Invalid referral code');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'referral');
    }
  };

  const skipReferral = () => setIsNewUser(false);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, logout, isNewUser, applyReferral, skipReferral }}>
      {children}
    </AuthContext.Provider>
  );
};

const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const errorInfo = JSON.parse(event.error.message);
        if (errorInfo.error) {
          setHasError(true);
          setErrorMessage(`A security or database error occurred: ${errorInfo.error}`);
        }
      } catch {
        // Not a FirestoreErrorInfo JSON
      }
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops! Something went wrong</h2>
          <p className="text-gray-600 mb-6">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-red-500 text-white py-3 rounded-xl font-semibold hover:bg-red-600 transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const ReferralCodeInput = () => {
  const { applyReferral, skipReferral } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    setLoading(true);
    await applyReferral(code);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center"
      >
        <div className="w-20 h-20 bg-purple-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <Users className="text-purple-600 w-10 h-10" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Got a Referral Code?</h2>
        <p className="text-gray-500 mb-8">Enter your friend's code to get a ₹50 welcome bonus instantly!</p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <input 
            type="text" 
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ENTER CODE"
            className="w-full px-4 py-4 rounded-2xl border-2 border-gray-100 text-center text-xl font-bold tracking-widest focus:border-indigo-500 outline-none transition-all"
          />
          <button 
            type="submit"
            disabled={loading || !code}
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Applying...' : 'Apply & Get ₹50'}
          </button>
          <button 
            type="button"
            onClick={skipReferral}
            className="w-full text-gray-400 py-2 text-sm font-medium hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const Navbar = () => {
  const { profile, logout } = useAuth();
  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
              Daily Earn
            </span>
          </div>
          {profile && (
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-medium text-gray-900">{profile.displayName}</span>
                <span className="text-xs text-gray-500">₹{profile.balance.toFixed(2)}</span>
              </div>
              <button 
                onClick={logout}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

const Dashboard = () => {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'referral' | 'withdraw' | 'history'>('tasks');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!profile) return;

    // Fetch tasks
    const tasksRef = collection(db, 'tasks');
    onSnapshot(tasksRef, (snapshot) => {
      const tasksList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      setTasks(tasksList);
      
      // Seed initial tasks if empty (for demo)
      if (tasksList.length === 0) {
        const initialTasks = [
          { id: 't1', title: 'Daily Check-in', reward: 10, description: 'Open the app every day to earn rewards.' },
          { id: 't2', title: 'Watch Video Ad', reward: 5, description: 'Watch a short video to earn ₹5.' },
          { id: 't3', title: 'Follow on Twitter', reward: 20, description: 'Follow our official handle for ₹20.' },
        ];
        initialTasks.forEach(t => setDoc(doc(db, 'tasks', t.id), t));
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'tasks'));

    // Fetch transactions
    const transRef = query(
      collection(db, 'transactions'), 
      where('uid', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    onSnapshot(transRef, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'transactions'));
  }, [profile]);

  const completeTask = async (task: Task) => {
    if (!profile) return;
    try {
      const newBalance = profile.balance + task.reward;
      await updateDoc(doc(db, 'users', profile.uid), { balance: newBalance });
      
      await addDoc(collection(db, 'transactions'), {
        uid: profile.uid,
        amount: task.reward,
        type: 'task',
        description: `Completed: ${task.title}`,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const copyReferral = () => {
    if (!profile) return;
    navigator.clipboard.writeText(profile.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <Wallet className="w-6 h-6" />
            </div>
            <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">Available Balance</span>
          </div>
          <div className="text-3xl font-bold mb-1">₹{profile?.balance.toFixed(2)}</div>
          <div className="text-indigo-100 text-sm">Keep earning to unlock rewards!</div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-purple-50 rounded-lg">
              <Users className="text-purple-600 w-6 h-6" />
            </div>
            <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-1 rounded-full">Referrals</span>
          </div>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {transactions.filter(t => t.type === 'referral').length}
          </div>
          <div className="text-gray-500 text-sm">Friends invited successfully</div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-emerald-50 rounded-lg">
              <CheckCircle2 className="text-emerald-600 w-6 h-6" />
            </div>
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">Tasks</span>
          </div>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {transactions.filter(t => t.type === 'task').length}
          </div>
          <div className="text-gray-500 text-sm">Tasks completed today</div>
        </motion.div>
      </div>

      {/* Main Content Tabs */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto scrollbar-hide">
          {[
            { id: 'tasks', label: 'Earn', icon: Gift },
            { id: 'referral', label: 'Invite', icon: Users },
            { id: 'withdraw', label: 'Withdraw', icon: Wallet },
            { id: 'history', label: 'History', icon: History },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'tasks' && (
              <motion.div 
                key="tasks"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {tasks.map((task) => (
                  <div key={task.id} className="group p-5 rounded-2xl border border-gray-100 hover:border-indigo-100 hover:bg-indigo-50/30 transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
                        <Gift className="w-5 h-5" />
                      </div>
                      <span className="text-lg font-bold text-indigo-600">₹{task.reward}</span>
                    </div>
                    <h3 className="font-bold text-gray-900 mb-1">{task.title}</h3>
                    <p className="text-sm text-gray-500 mb-4 line-clamp-2">{task.description}</p>
                    <button 
                      onClick={() => completeTask(task)}
                      className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-600 transition-colors"
                    >
                      Complete Task <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}

            {activeTab === 'referral' && (
              <motion.div 
                key="referral"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-2xl mx-auto text-center py-8"
              >
                <div className="w-20 h-20 bg-purple-100 rounded-3xl flex items-center justify-center text-purple-600 mx-auto mb-6">
                  <Users className="w-10 h-10" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Invite Friends & Earn More</h2>
                <p className="text-gray-500 mb-8">Share your referral code with friends. When they join, you both get ₹50 bonus!</p>
                
                <div className="flex items-center justify-center gap-3 p-2 bg-gray-50 rounded-2xl border border-gray-100 max-w-sm mx-auto mb-8">
                  <span className="text-xl font-mono font-bold text-gray-900 px-4">{profile?.referralCode}</span>
                  <button 
                    onClick={copyReferral}
                    className="p-3 bg-white text-gray-900 rounded-xl shadow-sm hover:bg-gray-50 transition-all active:scale-95"
                  >
                    {copied ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="p-4 rounded-2xl bg-gray-50">
                    <div className="font-bold text-gray-900">Step 1</div>
                    <div className="text-gray-500">Share Code</div>
                  </div>
                  <div className="p-4 rounded-2xl bg-gray-50">
                    <div className="font-bold text-gray-900">Step 2</div>
                    <div className="text-gray-500">Friend Joins</div>
                  </div>
                  <div className="p-4 rounded-2xl bg-gray-50">
                    <div className="font-bold text-gray-900">Step 3</div>
                    <div className="text-gray-500">Get ₹50</div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'withdraw' && (
              <motion.div 
                key="withdraw"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-md mx-auto py-8"
              >
                <div className="bg-indigo-50 rounded-2xl p-6 mb-8 text-center">
                  <div className="text-sm text-indigo-600 font-medium mb-1">Minimum Withdrawal</div>
                  <div className="text-3xl font-bold text-indigo-900">₹100.00</div>
                </div>

                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount to Withdraw</label>
                    <input 
                      type="number" 
                      placeholder="₹0.00"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                    <select className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all">
                      <option>UPI (PhonePe, GPay, Paytm)</option>
                      <option>Bank Transfer</option>
                      <option>Amazon Gift Card</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Details (UPI ID / A/c No)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. user@upi"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                  <button 
                    disabled={(profile?.balance || 0) < 100}
                    className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold hover:bg-indigo-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                  >
                    Request Withdrawal
                  </button>
                  {(profile?.balance || 0) < 100 && (
                    <p className="text-xs text-center text-red-500 flex items-center justify-center gap-1">
                      <AlertCircle className="w-3 h-3" /> You need ₹{(100 - (profile?.balance || 0)).toFixed(2)} more to withdraw
                    </p>
                  )}
                </form>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-3"
              >
                {transactions.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-300 mx-auto mb-4">
                      <History className="w-8 h-8" />
                    </div>
                    <p className="text-gray-500">No transactions yet. Start earning!</p>
                  </div>
                ) : (
                  transactions.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-4 rounded-2xl border border-gray-50 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          t.type === 'task' ? 'bg-emerald-50 text-emerald-600' :
                          t.type === 'referral' ? 'bg-purple-50 text-purple-600' :
                          'bg-red-50 text-red-600'
                        }`}>
                          {t.type === 'task' ? <CheckCircle2 className="w-5 h-5" /> :
                           t.type === 'referral' ? <Users className="w-5 h-5" /> :
                           <Wallet className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{t.description}</div>
                          <div className="text-xs text-gray-500">{t.createdAt?.toDate().toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div className={`font-bold ${t.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {t.amount > 0 ? '+' : ''}₹{t.amount.toFixed(2)}
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const Login = () => {
  const { signIn } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center"
      >
        <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-200">
          <TrendingUp className="text-white w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
        <p className="text-gray-500 mb-8">Start your daily earning journey today. Complete tasks and earn real rewards.</p>
        
        <button 
          onClick={signIn}
          className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-100 py-4 rounded-2xl font-bold text-gray-700 hover:bg-gray-50 hover:border-indigo-100 transition-all active:scale-95"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
          Continue with Google
        </button>
        
        <p className="mt-8 text-xs text-gray-400">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </motion.div>
    </div>
  );
};

const AppContent = () => {
  const { user, loading, isNewUser } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (user && isNewUser) {
    return <ReferralCodeInput />;
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      {user ? (
        <>
          <Navbar />
          <Dashboard />
        </>
      ) : (
        <Login />
      )}
    </div>
  );
};

export default function App() {
  return (
    <FirebaseProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </FirebaseProvider>
  );
}
