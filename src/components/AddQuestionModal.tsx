import React, { useState } from 'react';
import {
  X,
  Plus,
  HelpCircle,
  CheckSquare,
  Sparkles,
  Info,
  BookOpen
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Question, QuestionPart, BloomsLevel } from '../types';

interface AddQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingQuestion?: Question | null;
  /**
   * Called after a question is added or edited.
   * Lets a database-backed list reflect the change immediately.
   */
  onSaved?: (questionId: string, patch: Partial<Question>) => void;
}

export const AddQuestionModal: React.FC<AddQuestionModalProps> = ({
  isOpen,
  onClose,
  editingQuestion,
  onSaved
}) => {
  const { subjects, addQuestion, updateQuestion, selectedSubjectCode, currentUser } = useApp();

  const [subjectCode, setSubjectCode] = useState(
    editingQuestion ? editingQuestion.subjectCode : selectedSubjectCode || '24AM411'
  );
  const [unit, setUnit] = useState<number>(editingQuestion ? editingQuestion.unit : 1);
  const [topic, setTopic] = useState(editingQuestion ? editingQuestion.topic : '');
  const [part, setPart] = useState<QuestionPart>(editingQuestion ? editingQuestion.part : 'Part A');
  const [marks, setMarks] = useState<number>(
    editingQuestion ? editingQuestion.marks : (part === 'Part A' ? 2 : part === 'Part B' ? 13 : 15)
  );
  const [questionText, setQuestionText] = useState(editingQuestion ? editingQuestion.questionText : '');
  const [bloomsLevel, setBloomsLevel] = useState<BloomsLevel>(editingQuestion ? editingQuestion.bloomsLevel : 'K2');
  const [co, setCo] = useState(editingQuestion ? editingQuestion.co : 'CO1');
  const [pi, setPi] = useState(editingQuestion ? editingQuestion.pi : '1.1.1');
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>(
    editingQuestion ? editingQuestion.difficulty : 'Medium'
  );
  const [allowedFor, setAllowedFor] = useState({
    internal1: editingQuestion ? editingQuestion.allowedFor.internal1 : true,
    internal2: editingQuestion ? editingQuestion.allowedFor.internal2 : false,
    endSem: editingQuestion ? editingQuestion.allowedFor.endSem : true,
  });
  const [status, setStatus] = useState<'Draft' | 'Approved' | 'Pending'>(
    editingQuestion ? editingQuestion.status : 'Approved'
  );

  if (!isOpen) return null;

  const handlePartChange = (newPart: QuestionPart) => {
    setPart(newPart);
    if (newPart === 'Part A') setMarks(2);
    else if (newPart === 'Part B') setMarks(13);
    else if (newPart === 'Part C') setMarks(15);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionText.trim()) return;

    const payload = {
      subjectCode,
      unit,
      topic,
      part,
      marks,
      questionText,
      bloomsLevel,
      co,
      pi,
      difficulty,
      allowedFor,
      status,
    };

    if (editingQuestion) {
      updateQuestion(editingQuestion.id, payload);
      onSaved?.(editingQuestion.id, payload);
    } else {
      addQuestion({ ...payload, createdBy: currentUser.name });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-2xl my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-4">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#D71945]">
              Curriculum Bank
            </span>
            <h3 className="text-xl font-extrabold text-[#111827]">
              {editingQuestion ? 'Edit Question' : 'Add Question'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-[#94A3B8] hover:bg-[#F7F8FA] hover:text-[#111827] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Subject */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Subject
              </label>
              <select
                value={subjectCode}
                onChange={(e) => setSubjectCode(e.target.value)}
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] focus:border-[#D71945] focus:outline-hidden"
              >
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.code}>
                    {sub.code} – {sub.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Unit */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Syllabus Unit
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] focus:border-[#D71945] focus:outline-hidden"
              >
                <option value={1}>Unit I</option>
                <option value={2}>Unit II</option>
                <option value={3}>Unit III</option>
                <option value={4}>Unit IV</option>
                <option value={5}>Unit V</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Part */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Part
              </label>
              <select
                value={part}
                onChange={(e) => handlePartChange(e.target.value as QuestionPart)}
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] focus:border-[#D71945] focus:outline-hidden"
              >
                <option value="Part A">Part A (Short Answer - 2 Marks)</option>
                <option value="Part B">Part B (Descriptive - 13 Marks)</option>
                <option value="Part C">Part C (Application - 15 Marks)</option>
              </select>
            </div>

            {/* Marks */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Marks
              </label>
              <input
                type="number"
                value={marks}
                onChange={(e) => setMarks(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-2 text-xs text-[#111827] font-bold"
                readOnly
              />
            </div>

            {/* Topic */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Specific Topic
              </label>
              <input
                type="text"
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. A* Search, Pipelining"
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] focus:border-[#D71945] focus:outline-hidden"
              />
            </div>
          </div>

          {/* Question Text */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
              Question Text
            </label>
            <textarea
              rows={4}
              required
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="Enter full question description or problem statement..."
              className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-xs text-[#111827] focus:border-[#D71945] focus:ring-2 focus:ring-[#D71945]/20 focus:outline-hidden leading-relaxed"
            />
          </div>

          {/* Academic Mappings: BL, CO, PI, Difficulty */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Bloom's Level (BL)
              </label>
              <select
                value={bloomsLevel}
                onChange={(e) => setBloomsLevel(e.target.value as BloomsLevel)}
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] font-semibold focus:border-[#D71945] focus:outline-hidden"
              >
                <option value="K1">K1 - Remember</option>
                <option value="K2">K2 - Understand</option>
                <option value="K3">K3 - Apply</option>
                <option value="K4">K4 - Analyze</option>
                <option value="K5">K5 - Evaluate</option>
                <option value="K6">K6 - Create</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Course Outcome (CO)
              </label>
              <select
                value={co}
                onChange={(e) => setCo(e.target.value)}
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] font-semibold focus:border-[#D71945] focus:outline-hidden"
              >
                <option value="CO1">CO1</option>
                <option value="CO2">CO2</option>
                <option value="CO3">CO3</option>
                <option value="CO4">CO4</option>
                <option value="CO5">CO5</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Performance Ind. (PI)
              </label>
              <input
                type="text"
                value={pi}
                onChange={(e) => setPi(e.target.value)}
                placeholder="e.g. 1.2.1"
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] focus:border-[#D71945] focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#111827] mb-1">
                Difficulty
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as any)}
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#111827] focus:border-[#D71945] focus:outline-hidden"
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>

          {/* Question Eligibility (Allowed For) */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#111827]">
                Question Eligibility ("Allowed For")
              </span>
              <span className="text-[11px] text-[#64748B] flex items-center gap-1">
                <Info className="h-3.5 w-3.5 text-[#1976D2]" /> Where can this question be selected?
              </span>
            </div>
            <p className="text-[11px] text-[#64748B] mb-3">
              The faculty explicitly specifies where this question is approved for use. The system separately audits where it is actually used.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-white p-2.5 cursor-pointer hover:border-[#D71945]/40 transition-colors">
                <input
                  type="checkbox"
                  checked={allowedFor.internal1}
                  onChange={(e) => setAllowedFor({ ...allowedFor, internal1: e.target.checked })}
                  className="h-4 w-4 rounded accent-[#D71945]"
                />
                <span className="text-xs font-semibold text-[#111827]">Internal Assessment I</span>
              </label>

              <label className="flex items-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-white p-2.5 cursor-pointer hover:border-[#D71945]/40 transition-colors">
                <input
                  type="checkbox"
                  checked={allowedFor.internal2}
                  onChange={(e) => setAllowedFor({ ...allowedFor, internal2: e.target.checked })}
                  className="h-4 w-4 rounded accent-[#D71945]"
                />
                <span className="text-xs font-semibold text-[#111827]">Internal Assessment II</span>
              </label>

              <label className="flex items-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-white p-2.5 cursor-pointer hover:border-[#D71945]/40 transition-colors">
                <input
                  type="checkbox"
                  checked={allowedFor.endSem}
                  onChange={(e) => setAllowedFor({ ...allowedFor, endSem: e.target.checked })}
                  className="h-4 w-4 rounded accent-[#D71945]"
                />
                <span className="text-xs font-semibold text-[#111827]">End Semester</span>
              </label>
            </div>
          </div>

          {/* Status Selection */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#64748B]">Status:</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827]"
              >
                <option value="Approved">Approved</option>
                <option value="Pending">Pending Review</option>
                <option value="Draft">Draft</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#D71945] px-6 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer"
              >
                Save Question
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
