import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarDays, Clock3, Lock, CheckCircle2 } from "lucide-react";

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
  slots: SlotView[];
};

type MessageState =
  | {
      type: "error" | "success";
      text: string;
    }
  | null;

type SlotState = "open" | "reserved" | "blocked";

const WEEKDAY_KR = ["일", "월", "화", "수", "목", "금", "토"];

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

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAY_KR[d.getDay()]})`;
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
    const reservation = reservationMap.get(slot.id);

    const slotView: SlotView = {
      id: slot.id,
      slotDate: slot.slot_date,
      startTime: formatTime(slot.start_time),
      endTime: formatTime(slot.end_time),
      status: slot.status,
      memberName: reservation?.member_name ?? null,
    };

    const existing = grouped.get(slot.slot_date);
    if (existing) {
      existing.slots.push(slotView);
      return;
    }

    grouped.set(slot.slot_date, {
      dateKey: slot.slot_date,
      label: formatDateLabel(slot.slot_date),
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

export default function MemberPage() {
  const [slots, setSlots] = useState<LessonSlotRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedSlot, setSelectedSlot] = useState<SlotView | null>(null);
  const [name, setName] = useState<string>("");
  const [message, setMessage] = useState<MessageState>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const currentWeekKey = useMemo(() => dateKey(getMonday(new Date())), []);
  const groupedDays = useMemo(() => buildDayGroups(slots, reservations), [slots, reservations]);

  const reservationsBySlot = useMemo(() => {
    const map = new Map<string, ReservationRow>();
    reservations.forEach((r) => map.set(r.slot_id, r));
    return map;
  }, [reservations]);

  const memberHasReservationThisWeek = (memberName: string): boolean => {
    return reservations.some(
      (r) => r.week_start_date === currentWeekKey && r.member_name.trim() === memberName.trim()
    );
  };

  const getSlotState = (slot: SlotView): SlotState => {
    if (slot.status === "blocked") return "blocked";
    if (reservationsBySlot.has(slot.id)) return "reserved";
    return "open";
  };

  const fetchWeekData = async () => {
    setLoading(true);

    const { data: slotsData, error: slotsError } = await supabase
      .from("lesson_slots")
      .select("id, slot_date, week_start_date, start_time, end_time, status")
      .eq("week_start_date", currentWeekKey)
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (slotsError) {
      console.error(slotsError);
      setMessage({ type: "error", text: "시간표를 불러오는 데 실패했습니다." });
      setLoading(false);
      return;
    }

    const { data: reservationsData, error: reservationsError } = await supabase
      .from("reservations")
      .select("id, slot_id, member_name, week_start_date, created_at")
      .eq("week_start_date", currentWeekKey)
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
  }, [currentWeekKey]);

  const openBookingDialog = (slot: SlotView): void => {
    if (getSlotState(slot) !== "open") return;
    setName("");
    setMessage(null);
    setSelectedSlot(slot);
  };

  const closeDialog = (): void => {
    setSelectedSlot(null);
    setMessage(null);
    setSubmitting(false);
  };

  const handleReserve = async (): Promise<void> => {
    if (!selectedSlot) return;

    const trimmed = name.trim();

    if (!trimmed) {
      setMessage({ type: "error", text: "이름을 입력해 주세요." });
      return;
    }

    if (selectedSlot.status === "blocked") {
      setMessage({ type: "error", text: "해당 시간은 예약할 수 없습니다." });
      return;
    }

    if (reservationsBySlot.has(selectedSlot.id)) {
      setMessage({
        type: "error",
        text: "방금 다른 회원님이 먼저 예약했습니다. 다른 시간을 선택해 주세요.",
      });
      return;
    }

    if (memberHasReservationThisWeek(trimmed)) {
      setMessage({
        type: "error",
        text: "이번 주는 이미 예약하셨습니다. 1인당 주 1회만 신청 가능합니다.",
      });
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.from("reservations").insert({
      slot_id: selectedSlot.id,
      member_name: trimmed,
      week_start_date: currentWeekKey,
    });

    if (error) {
      console.error(error);
      setSubmitting(false);
      setMessage({
        type: "error",
        text: "이미 예약되었거나 이번 주에 이미 신청한 이름입니다.",
      });
      return;
    }

    await fetchWeekData();
    setSubmitting(false);
    setMessage({ type: "success", text: "예약이 완료되었습니다." });
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <Card className="rounded-3xl border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex justify-center items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <CalendarDays className="h-5 w-5 font-bold" />
                  주간 레슨 신청
                </CardTitle>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">

            {loading ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                시간표를 불러오는 중...
              </div>
            ) : groupedDays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                이번 주에 열려 있는 레슨 시간이 아직 없습니다.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {groupedDays.map((day) => (
                  <Card key={day.dateKey} className="rounded-3xl border-slate-200 shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-xl font-bold">{day.label}</CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      {day.slots.map((slot) => {
                        const state = getSlotState(slot);
                        const reservation = reservationsBySlot.get(slot.id);

                        const stateStyle =
                          state === "open"
                            ? "bg-green-200 hover:bg-green-300 border-slate-300"
                            : state === "reserved"
                            ? "bg-red-200 border-slate-200 text-slate-600"
                            : "bg-slate-100 border-slate-200 text-slate-400";

                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => openBookingDialog(slot)}
                            className={`w-full rounded-2xl border p-4 text-left transition ${stateStyle}`}
                            disabled={state !== "open"}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 text-xl font-semibold">
                                  <Clock3 className="h-4 w-4" />
                                  {slot.startTime} ~ {slot.endTime}
                                </div>

                                <div className="mt-2 text-xl font-semibold leading-6 text-slate-600">
                                  {state === "open" && "예약 가능"}
                                  {state === "reserved" && (
                                    <span>{reservation?.member_name}</span>
                                  )}
                                  {state === "blocked" && "예약 불가"}
                                </div>
                              </div>

                              {/* <div>
                                {state === "open" && <Badge className="rounded-xl">가능</Badge>}
                                {state === "reserved" && (
                                  <Badge variant="secondary" className="rounded-xl">
                                    마감
                                  </Badge>
                                )}
                                {state === "blocked" && (
                                  <Badge variant="outline" className="rounded-xl">
                                    불가
                                  </Badge>
                                )}
                              </div> */}
                            </div>
                          </button>
                        );
                      })}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedSlot} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-md overflow-hidden rounded-3xl p-0">
          <DialogHeader className="border-b bg-white px-6 py-5">
            <DialogTitle className="text-xl">레슨 신청</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            {selectedSlot && (
              <div className="rounded-2xl bg-slate-50 p-4 text-base leading-7 text-slate-800">
                <div className="font-semibold">선택한 시간</div>
                <div className="mt-2">
                  {formatDateLabel(selectedSlot.slotDate)} {selectedSlot.startTime} ~{" "}
                  {selectedSlot.endTime}
                </div>
              </div>
            )}

            {message && (
              <Alert
                className={`rounded-2xl ${
                  message.type === "success"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-rose-200 bg-rose-50"
                }`}
              >
                <AlertDescription className="text-base leading-7">
                  {message.type === "success" ? (
                    <span className="flex items-center gap-2 text-emerald-800">
                      <CheckCircle2 className="h-5 w-5" />
                      {message.text}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-rose-800">
                      <Lock className="h-5 w-5" />
                      {message.text}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {!message || message.type !== "success" ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">이름</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="이름을 입력해 주세요"
                    className="h-14 rounded-2xl text-lg"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="h-14 rounded-2xl text-base"
                    onClick={closeDialog}
                    disabled={submitting}
                  >
                    취소
                  </Button>
                  <Button
                    className="h-14 rounded-2xl text-base"
                    onClick={handleReserve}
                    disabled={submitting}
                  >
                    {submitting ? "예약 중..." : "예약하기"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl bg-emerald-50 p-4 text-base leading-7 text-emerald-900">
                  <div className="font-semibold">예약이 정상적으로 접수됐습니다.</div>
                  <div className="mt-2">변경이나 취소가 필요하면 운영자에게 문의해 주세요.</div>
                </div>
                <Button className="h-14 w-full rounded-2xl text-base" onClick={closeDialog}>
                  확인
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}