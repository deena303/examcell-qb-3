import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  FileCheck2,
  Sparkles,
  Database,
  ArrowRight,
  ScanLine,
  GraduationCap
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export const DashboardView: React.FC = () => {
  const {
    subjects,
    generatedPapers,
    setActiveTab,
    currentUser,
    authToken
  } = useApp();

  // Question bank count from backend (Supabase)
  const [questionBankCount, setQuestionBankCount] = useState<number | null>(null);
  const [loadingBanks, setLoadingBanks] = useState(true);

  useEffect(() => {
    // Fetch real question bank count from backend
    if (!authToken) {
      setQuestionBankCount(0);
      setLoadingBanks(false);
      return;
    }
    fetch('/api/question-banks/count', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(res => res.ok && res.headers.get('content-type')?.includes('application/json') ? res.json() : null)
      .then(data => {
        if (data && typeof data.count === 'number') {
          setQuestionBankCount(data.count);
        } else {
          setQuestionBankCount(0);
        }
      })
      .catch(() => setQuestionBankCount(0))
      .finally(() => setLoadingBanks(false));
  }, [authToken]);

  const subjectsCount = subjects.length;
  const papersCount = generatedPapers.length;

  const statsCards = [
    {
      id: 'subjects',
      icon: BookOpen,
      label: 'Subjects',
      value: subjectsCount,
      loading: false,
      color: '#D71945',
      bgColor: '#FFF0F3',
      description: 'Active subjects in curriculum',
      action: 'subjects',
      actionLabel: 'Manage Subjects',
    },
    {
      id: 'question-banks',
      icon: Database,
      label: 'Question Banks',
      value: questionBankCount,
      loading: loadingBanks,
      color: '#1976D2',
      bgColor: '#EAF3FF',
      description: 'Uploaded question bank documents',
      action: 'question-bank',
      actionLabel: 'View Question Banks',
    },
    {
      id: 'generated-papers',
      icon: FileCheck2,
      label: 'Generated Papers',
      value: papersCount,
      loading: false,
      color: '#027A48',
      bgColor: '#ECFDF3',
      description: 'Question papers generated',
      action: 'generated-papers',
      actionLabel: 'View Papers',
    },
  ];

  const quickActions = [
    {
      id: 'import-question-bank',
      icon: ScanLine,
      label: 'Import Question Bank',
      description: 'Upload a question bank PDF for extraction',
      accent: '#D71945',
      highlight: true,
    },
    {
      id: 'generate-paper',
      icon: Sparkles,
      label: 'Generate Paper',
      description: 'Auto-generate a balanced question paper',
      accent: '#1976D2',
      highlight: false,
    },
    {
      id: 'subjects',
      icon: GraduationCap,
      label: 'Manage Subjects',
      description: 'Add or edit subjects in the curriculum',
      accent: '#B45309',
      highlight: false,
    },
  ];

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="border-b border-[#E5E7EB] pb-6">
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
          Dashboard
        </span>
        <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
          {getGreeting()}, {currentUser.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">
          MSAJCE Autonomous Examination – Question Paper Management System
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {statsCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              className="rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: card.bgColor }}
                >
                  <Icon className="h-5 w-5" style={{ color: card.color }} />
                </div>
                <button
                  onClick={() => setActiveTab(card.action)}
                  className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#111827] hover:bg-[#F7F8FA] transition-colors"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4">
                {card.loading ? (
                  <div className="h-9 w-16 rounded-xl bg-[#F1F5F9] animate-pulse" />
                ) : (
                  <div
                    className="text-4xl font-black"
                    style={{ color: card.color }}
                  >
                    {card.value ?? 0}
                  </div>
                )}
                <div className="mt-1 text-sm font-bold text-[#111827]">{card.label}</div>
                <div className="text-xs text-[#64748B] mt-0.5">{card.description}</div>
              </div>

              <button
                onClick={() => setActiveTab(card.action)}
                className="mt-4 text-xs font-semibold transition-colors"
                style={{ color: card.color }}
              >
                {card.actionLabel} →
              </button>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-black text-[#111827] uppercase tracking-wider mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => setActiveTab(action.id)}
                className={`flex items-start gap-4 rounded-2xl border p-4 text-left transition-all hover:shadow-md active:scale-[0.98] cursor-pointer ${
                  action.highlight
                    ? 'border-rose-200 bg-rose-50 hover:bg-rose-100'
                    : 'border-[#E5E7EB] bg-white hover:bg-[#F7F8FA]'
                }`}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: action.highlight ? '#FFF0F3' : '#F7F8FA' }}
                >
                  <Icon className="h-5 w-5" style={{ color: action.accent }} />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#111827]">{action.label}</div>
                  <div className="text-xs text-[#64748B] mt-0.5">{action.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
