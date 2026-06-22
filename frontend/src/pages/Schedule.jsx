import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import RequireUser from '../components/RequireUser';
import {
  generateSchedule,
  generateQuiz,
  getSchedule,
  completeEntry,
  skipEntry,
  readyTopicForQuizzes,
  generateScheduleFromSyllabusPdf,
} from '../services/api';
import toast from 'react-hot-toast';
import { CalendarDays, RefreshCw } from 'lucide-react';

export default function Schedule() {
  const { userId, logout } = useUser();
  const location = useLocation();
  const [entries, setEntries] = useState([]);
  const [entryLoading, setEntryLoading] = useState({});
  const [loading, setLoading] = useState(false);
  const defaultStartDate = '';
  const defaultEndDate = '';
  const navigate = useNavigate();

  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [startTime, setStartTime] = useState('08:00');
  const [dailyHours, setDailyHours] = useState(4);
  const [session, setSession] = useState(60);
  const [breakMins, setBreakMins] = useState(15);
  const [coverageEndDate, setCoverageEndDate] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfStart, setPdfStart] = useState(today);
  const [pdfEnd, setPdfEnd] = useState('');
  const [pdfDailyHours, setPdfDailyHours] = useState(4);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');

  const openGeneratedQuiz = async (topicId, source) => {
    try {
      const { data } = await generateQuiz({
        user_id: userId,
        topic_id: topicId,
        difficulty: 'medium',
        num_questions: 5,
      });
      navigate('/quiz', {
        state: { generatedQuiz: data, topicId, source, autoGenerate: false },
      });
      return true;
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Quiz generation is unavailable right now.');
      return false;
    }
  };

  const loadSchedule = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await getSchedule(userId);
      setEntries(data);
      setCoverageEndDate('');
    } catch (err) {
      if (err.response?.status === 404) {
        logout();
        toast.error('Your saved session is no longer valid. Sign in again.');
      }
    }
  }, [userId]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule, location.key]);

  const handleComplete = async (entry) => {
    setEntryLoading((prev) => ({ ...prev, [entry.id]: true }));
    try {
      await completeEntry(entry.id);
      toast.success('Marked session complete');
      await loadSchedule();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not mark complete');
    } finally {
      setEntryLoading((prev) => ({ ...prev, [entry.id]: false }));
    }
  };

  const [referencedIds, setReferencedIds] = useState({});

  const handleReference = (entry) => {
    const query = encodeURIComponent(entry.topic_name || entry.subject_name || 'study');
    window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
    setReferencedIds((prev) => ({ ...prev, [entry.id]: true }));
  };

  const handleSkip = async (entry) => {
    setEntryLoading((prev) => ({ ...prev, [entry.id]: true }));
    try {
      await skipEntry(entry.id);
      toast.success('Session skipped and rescheduled');
      loadSchedule();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to skip session');
    } finally {
      setEntryLoading((prev) => ({ ...prev, [entry.id]: false }));
    }
  };

  const handleTakeQuiz = async (entry) => {
    if (!userId || !entry.topic_id) return;
    setEntryLoading((prev) => ({ ...prev, [entry.id]: true }));
    try {
      const { data } = await readyTopicForQuizzes(entry.topic_id, {
        user_id: userId,
        num_questions: 5,
      });
      if (data.quizzes?.length) {
        navigate('/quiz', {
          state: { readyQuizzes: data.quizzes, topicId: entry.topic_id, source: 'schedule' },
        });
      } else {
        const opened = await openGeneratedQuiz(entry.topic_id, 'schedule');
        if (!opened) {
          navigate('/quiz', {
            state: { topicId: entry.topic_id, source: 'schedule' },
          });
        }
      }
    } catch (err) {
      const opened = await openGeneratedQuiz(entry.topic_id, 'schedule');
      if (!opened) {
        navigate('/quiz', {
          state: { topicId: entry.topic_id, source: 'schedule' },
        });
      }
    } finally {
      setEntryLoading((prev) => ({ ...prev, [entry.id]: false }));
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await generateSchedule({
        user_id: userId,
        start_date: startDate,
        end_date: endDate,
        daily_start_time: `${startTime}:00`,
        daily_study_hours: dailyHours,
        session_duration_mins: session,
        break_duration_mins: breakMins,
      });
      setEntries(data);
      const generatedLastDate = data.reduce(
        (latest, entry) => (!latest || entry.scheduled_date > latest ? entry.scheduled_date : latest),
        '',
      );
      const extendedBeyondRequested = generatedLastDate && generatedLastDate > endDate;
      setCoverageEndDate(extendedBeyondRequested ? generatedLastDate : '');
      toast.success(
        extendedBeyondRequested
          ? `Generated ${data.length} study sessions through ${generatedLastDate} to cover the full syllabus.`
          : `Generated ${data.length} study sessions!`,
      );
    } catch (err) {
      if (err.response?.status === 404) {
        logout();
        toast.error('Your saved session is no longer valid. Sign in again.');
      } else if (err.response?.status === 400) {
        toast.error(err.response?.data?.detail || 'Add subjects and topics before generating a schedule.');
      } else {
        toast.error(err.response?.data?.detail || 'Error generating schedule');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateFromPdf = async (e) => {
    e.preventDefault();
    if (!pdfFile) {
      toast.error('Upload a syllabus PDF first.');
      return;
    }
    if (!pdfStart || !pdfEnd) {
      toast.error('Choose start and end dates first.');
      return;
    }
    setPdfLoading(true);
    setPdfStatus('Extracting syllabus topics and generating your schedule. This can take a little while for larger PDFs.');
    try {
      const derivedSubjectName = (pdfFile?.name || '').replace(/\.pdf$/i, '').trim();
      const formData = new FormData();
      formData.append('user_id', userId);
      formData.append('file', pdfFile);
      formData.append('start_date', pdfStart);
      formData.append('end_date', pdfEnd);
      if (derivedSubjectName) {
        formData.append('subject_name', derivedSubjectName);
      }
      formData.append('daily_start_time', '08:00:00');
      formData.append('daily_study_hours', pdfDailyHours);
      formData.append('session_duration_mins', 60);
      formData.append('break_duration_mins', 15);
      formData.append('unit_start', 1);
      formData.append('unit_end', 12);
      formData.append('max_topics_per_unit', 120);
      formData.append('max_topics_per_day', 4);
      formData.append('include_revisions', true);
      formData.append('revision_days', 3);
      formData.append('auto_generate_quizzes', false);
      formData.append('no_ai_mode', false);
      formData.append('import_all_subjects', true);
      formData.append('quiz_difficulty', 'medium');
      formData.append('quiz_questions', 5);

      const { data } = await generateScheduleFromSyllabusPdf(formData);
      setEntries(data.schedule_entries || []);
      setCoverageEndDate(data.coverage_end_date || '');
      setPdfStatus('');
      toast.success(
        data.coverage_end_date && data.coverage_end_date > pdfEnd
          ? `Generated ${data.schedule_entries?.length || 0} sessions and extended through ${data.coverage_end_date} to cover all topics.`
          : `Generated ${data.schedule_entries?.length || 0} sessions from PDF`,
      );
    } catch (err) {
      const detail = err.response?.data?.detail || '';
      if (err.code === 'ECONNABORTED') {
        const message = 'PDF schedule generation timed out. Try a smaller PDF or retry once.';
        toast.error(message);
        setPdfStatus(message);
      } else {
        toast.error(detail || 'Could not generate from PDF');
        setPdfStatus(detail || 'Could not generate from PDF');
      }
    } finally {
      setPdfLoading(false);
    }
  };

  const grouped = entries.reduce((acc, entry) => {
    const dateKey = entry.scheduled_date;
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(entry);
    return acc;
  }, {});
  const sortedEntries = [...entries].sort((a, b) =>
    `${a.scheduled_date}T${a.start_time}`.localeCompare(`${b.scheduled_date}T${b.start_time}`),
  );
  const todayEntries = sortedEntries.filter((e) => e.scheduled_date === today);
  const firstPendingToday = todayEntries.find((e) => !e.completed);
  const allTodayDone = todayEntries.length > 0 && todayEntries.every((e) => e.completed);
  const isQuizLocked = (entry) => {
    if (entry.completed) return false;
    // If today has pending entries, lock everything except today's first pending
    if (firstPendingToday) {
      return entry.id !== firstPendingToday.id;
    }
    // Today is fully done — unlock tomorrow's first pending only
    if (allTodayDone) {
      const futureSorted = sortedEntries.filter((e) => e.scheduled_date > today && !e.completed);
      const firstFuturePending = futureSorted[0];
      return !firstFuturePending || entry.id !== firstFuturePending.id;
    }
    return true;
  };

  return (
    <RequireUser>
      <div className="page page-wide schedule-page">
        <section className="page-hero schedule-page-hero">
          <div>
            <span className="page-kicker">
              <CalendarDays size={14} />
              Schedule
            </span>
            <h1 className="page-title">Study Schedule</h1>
            <p className="page-copy">Generate a clean study plan from your syllabus PDF and keep each day actionable.</p>
          </div>
          <div className="page-hero-stats">
            <article>
              <span>Sessions</span>
              <strong>{entries.length}</strong>
            </article>
            <article>
              <span>Days Planned</span>
              <strong>{Object.keys(grouped).length}</strong>
            </article>
            <article>
              <span>Coverage</span>
              <strong>{coverageEndDate || 'In range'}</strong>
            </article>
          </div>
        </section>

        <form className="card form schedule-form schedule-upload-card" onSubmit={handleGenerateFromPdf}>
          <h3>Generate from Syllabus PDF</h3>
          <p className="text-muted schedule-upload-copy">Upload one PDF and let the planner turn it into dated study sessions.</p>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>PDF file</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                required
              />
            </div>
            <div className="form-group">
              <label>Start date</label>
              <input type="date" value={pdfStart} min={today} onChange={(e) => setPdfStart(e.target.value)} />
            </div>
            <div className="form-group">
              <label>End date</label>
              <input type="date" value={pdfEnd} min={today} onChange={(e) => setPdfEnd(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Daily study hours</label>
              <input
                type="number"
                min="0.5"
                max="16"
                step="0.5"
                value={pdfDailyHours}
                onChange={(e) => setPdfDailyHours(+e.target.value)}
              />
            </div>
          </div>

          <button className="btn btn-primary" type="submit" disabled={pdfLoading}>
            <RefreshCw size={14} className={pdfLoading ? 'spin' : ''} />
            {pdfLoading ? ' Generating...' : ' Generate from PDF'}
          </button>
          {pdfStatus && (
            <p className="text-muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              {pdfStatus}
            </p>
          )}
        </form>

        {coverageEndDate && (
          <div className="card">
            <p style={{ margin: 0 }}>
              The plan extends through <strong>{coverageEndDate}</strong> so all syllabus topics are covered.
            </p>
          </div>
        )}

        {Object.keys(grouped).length === 0 && (
          <div className="card page-empty-state">
            No schedule yet. Generate one from your syllabus PDF to start filling this planner.
          </div>
        )}

        {Object.entries(grouped).map(([date, items]) => (
          <div key={date} className="card schedule-day-shell">
            <h3>{date}</h3>
            <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Subject</th>
                <th>Topic</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr
                  key={entry.id}
                  className={`schedule-row ${entry.completed ? 'schedule-row-completed' : ''}`}
                >
                  <td>
                    {entry.start_time?.slice(0, 5)} - {entry.end_time?.slice(0, 5)}
                  </td>
                  <td>{entry.subject_name}</td>
                  <td>{entry.topic_name}</td>
                  <td>
                    <div className="schedule-actions">
                      <button
                        className={`btn btn-xs ${referencedIds[entry.id] ? 'btn-success' : 'btn-outline'}`}
                        onClick={() => referencedIds[entry.id] ? handleComplete(entry) : handleReference(entry)}
                        disabled={entryLoading[entry.id] || entry.completed}
                        title={referencedIds[entry.id] ? 'Mark as finished' : `Search "${entry.topic_name}" on YouTube`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        {!referencedIds[entry.id] && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#FF0000">
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                          </svg>
                        )}
                        {entry.completed ? 'Completed' : referencedIds[entry.id] ? 'Finished' : 'Reference'}
                      </button>

                      <button
                        className="btn btn-xs btn-outline"
                        disabled={entryLoading[entry.id]}
                        onClick={() => handleSkip(entry)}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        Reschedule
                      </button>
                      <button
                        className="btn btn-xs btn-primary"
                        disabled={entryLoading[entry.id] || isQuizLocked(entry)}
                        onClick={() => handleTakeQuiz(entry)}
                        title={isQuizLocked(entry) ? 'Complete today\'s session first.' : undefined}
                      >
                        Take Quiz
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </RequireUser>
  );
}


