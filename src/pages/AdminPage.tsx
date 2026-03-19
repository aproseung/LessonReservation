import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Settings2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

type LessonSlotRow = {
  id: string;
  slot_date: string;
  week_start_date: string;
  start_time: string;
  end_time: string;
  status: "open" | "blocked";
};

type ReservationRow = {
  id: string;
  slot_id: string;
  member_name: string;
  week_start_date: string;
  created_at: string;
};

type SlotView = {
  id: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  status: "open" | "blocked";
  memberName: string | null;
};

type DayGroup = {
  dateKey: string;
  label: string;
  weekday: number;
  slots: SlotView[];
};

type MessageState =
  | {
      type: "success" | "error";
      text: string;
    }
  | null;

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const ADMIN_DAY_OPTIONS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 0, label: "일" },
];

function getMonday(date: Date = new Date()): Date {
  const d = new Date(date);
  const sunday14 = new Date(d);
  sunday14.setDate(sunday14.getDate() - sunday14.getDay());
  sunday14.setHours(14, 0, 0, 0);

  if (d < sunday14) {
    sunday14.setDate(sunday14.getDate() - 7);
  }

  const monday = new Date(sunday14);
  monday.setDate(monday.getDate() + 1);
  monday.setHours(0, 0, 0, 0);

  return monday;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAY_LABELS[d.getDay()]})`;
}

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function buildDayGroups(
  slots: LessonSlotRow[],
  reservations: ReservationRow[]
): DayGroup[] {
  const reservationMap = new Map<string, ReservationRow>();
  reservations.forEach((r) => {
    reservationMap.set(r.slot_id, r);
  });

  const grouped = new Map<string, DayGroup>();

  slots.forEach((slot) => {
    const slotView: SlotView = {
      id: slot.id,
      slotDate: slot.slot_date,
      startTime: formatTime(slot.start_time),
      endTime: formatTime(slot.end_time),
      status: slot.status,
      memberName: reservationMap.get(slot.id)?.member_name ?? null,
    };

    const existing = grouped.get(slot.slot_date);
    if (existing) {
      existing.slots.push(slotView);
      return;
    }

    const d = new Date(slot.slot_date);
    grouped.set(slot.slot_date, {
      dateKey: slot.slot_date,
      label: formatDateLabel(slot.slot_date),
      weekday: d.getDay(),
      slots: [slotView],
    });
  });

  return Array.from(grouped.values())
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .map((group) => ({
      ...group,
      slots: group.slots.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }));
}



export default function AdminPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [lessonDays, setLessonDays] = useState<number[]>([1, 3, 4]);
  const [slots, setSlots] = useState<LessonSlotRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  const weekStartDate = useMemo(() => {
    const monday = getMonday(addDays(new Date(), weekOffset * 7));
    return dateKey(monday);
  }, [weekOffset]);

  const weekTitle = useMemo(() => {
    const monday = new Date(weekStartDate);
    const sunday = addDays(monday, 6);
    return `${monday.getMonth() + 1}월 ${monday.getDate()}일 ~ ${sunday.getMonth() + 1}월 ${sunday.getDate()}일`;
  }, [weekStartDate]);

  const groupedDays = useMemo(() => buildDayGroups(slots, reservations), [slots, reservations]);

  const fetchWeekData = async () => {
    setLoading(true);
    setMessage(null);

    const { data: settingData, error: settingError } = await supabase
      .from("weekly_settings")
      .select("week_start_date, lesson_days")
      .eq("week_start_date", weekStartDate)
      .maybeSingle();

    if (settingError) {
      console.error(settingError);
      setMessage({ type: "error", text: "주간 설정을 불러오는 데 실패했습니다." });
      setLoading(false);
      return;
    }

    const currentLessonDays =
      settingData?.lesson_days && settingData.lesson_days.length > 0
        ? [...settingData.lesson_days].sort((a, b) => a - b)
        : [1, 3, 4];

    setLessonDays(currentLessonDays);

    const { data: slotsData, error: slotsError } = await supabase
      .from("lesson_slots")
      .select("id, slot_date, week_start_date, start_time, end_time, status")
      .eq("week_start_date", weekStartDate)
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (slotsError) {
      console.error(slotsError);
      setMessage({ type: "error", text: "시간표 정보를 불러오는 데 실패했습니다." });
      setLoading(false);
      return;
    }

    const { data: reservationsData, error: reservationsError } = await supabase
      .from("reservations")
      .select("id, slot_id, member_name, week_start_date, created_at")
      .eq("week_start_date", weekStartDate)
      .order("created_at", { ascending: true });

    if (reservationsError) {
      console.error(reservationsError);
      setMessage({ type: "error", text: "예약 정보를 불러오는 데 실패했습니다." });
      setLoading(false);
      return;
    }

    setSlots((slotsData ?? []) as LessonSlotRow[]);
    setReservations((reservationsData ?? []) as ReservationRow[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchWeekData();
  }, [weekStartDate]);

  const toggleLessonDay = (day: number) => {
    setLessonDays((prev) => {
      if (prev.includes(day)) {
        return prev.filter((d) => d !== day).sort((a, b) => a - b);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  };

  const handleSaveWeekSetting = async () => {
    if (lessonDays.length === 0) {
      setMessage({ type: "error", text: "최소 1개 요일은 선택해야 합니다." });
      return;
    }

    setSaving(true);
    setMessage(null);

    const { error: upsertError } = await supabase
      .from("weekly_settings")
      .upsert(
        {
          week_start_date: weekStartDate,
          lesson_days: lessonDays,
        },
        { onConflict: "week_start_date" }
      );

    if (upsertError) {
      console.error(upsertError);
      setSaving(false);
      setMessage({ type: "error", text: "주간 설정 저장에 실패했습니다." });
      return;
    }

    const { error: rpcError } = await supabase.rpc("regenerate_week_slots", {
      p_week_start_date: weekStartDate,
      p_lesson_days: lessonDays,
    });

    if (rpcError) {
      console.error(rpcError);
      setSaving(false);
      setMessage({ type: "error", text: "시간표 재생성에 실패했습니다." });
      return;
    }

    await fetchWeekData();
    setSaving(false);
    setMessage({ type: "success", text: "주간 설정을 저장했습니다." });
  };

  const handleDeleteReservation = async (reservationId: string) => {
    const ok = window.confirm("이 예약을 취소할까요?");
    if (!ok) return;

    const { error } = await supabase
        .from("reservations")
        .delete()
        .eq("id", reservationId);

    if (error) {
        console.error(error);
        setMessage({ type: "error", text: "예약 취소에 실패했습니다." });
        return;
    }

    setMessage({ type: "success", text: "예약을 취소했습니다." });
    await fetchWeekData();
    };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <Card className="rounded-3xl border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Settings2 className="h-5 w-5" />
                  관리자 페이지
                </CardTitle>
                <p className="mt-2 text-sm text-slate-600">
                  주차 이동, 레슨 요일 설정, 신청 현황 확인
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setWeekOffset((v) => v - 1)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  이전 주
                </Button>

                <div className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium text-slate-700">
                  {weekTitle}
                </div>

                <Button
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setWeekOffset((v) => v + 1)}
                >
                  다음 주
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {message && (
              <Alert
                className={`rounded-2xl ${
                  message.type === "success"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-rose-200 bg-rose-50"
                }`}
              >
                <AlertDescription className="text-base leading-7">
                  <span
                    className={`flex items-center gap-2 ${
                      message.type === "success"
                        ? "text-emerald-800"
                        : "text-rose-800"
                    }`}
                  >
                    {message.type === "success" ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <AlertCircle className="h-5 w-5" />
                    )}
                    {message.text}
                  </span>
                </AlertDescription>
              </Alert>
            )}

            <Card className="rounded-3xl border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="text-lg">이 주의 레슨 요일 설정</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  {ADMIN_DAY_OPTIONS.map((day) => (
                    <label
                      key={day.value}
                      className="flex items-center gap-2 rounded-2xl border bg-white px-4 py-3"
                    >
                      <Checkbox
                        checked={lessonDays.includes(day.value)}
                        onCheckedChange={() => toggleLessonDay(day.value)}
                      />
                      <span className="text-sm font-medium">{day.label}</span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button
                    className="rounded-2xl"
                    onClick={handleSaveWeekSetting}
                    disabled={saving}
                  >
                    {saving ? "저장 중..." : "요일 설정 저장"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CalendarDays className="h-5 w-5" />
                  신청 현황
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                    불러오는 중...
                  </div>
                ) : groupedDays.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                    아직 생성된 슬롯이 없습니다. 요일 설정을 저장하세요.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-3">
                    {groupedDays.map((day) => (
                      <Card key={day.dateKey} className="rounded-3xl border-slate-200 shadow-none">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg">{day.label}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {day.slots.map((slot) => (
                            <div
                              key={slot.id}
                              className={`w-full rounded-2xl border p-4 text-left ${
                                slot.memberName
                                  ? "bg-slate-100 border-slate-200 text-slate-700"
                                  : "bg-white border-slate-300"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2 text-base font-semibold">
                                    <Clock3 className="h-4 w-4" />
                                    {slot.startTime} ~ {slot.endTime}
                                  </div>
                                  <div className="mt-2 text-sm leading-6 text-slate-600">
                                    {slot.memberName ? `마감 · ${slot.memberName}` : "예약 가능"}
                                  </div>
                                </div>

                                <div>
                                  {slot.memberName ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-xl"
                                        onClick={() => {
                                            const reservation = reservations.find((r) => r.slot_id === slot.id);
                                            if (reservation) handleDeleteReservation(reservation.id);
                                        }}
                                        >
                                        취소
                                    </Button>
                                  ) : (
                                    <Badge className="rounded-xl">가능</Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}