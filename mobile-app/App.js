import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://trax-attendance-backend.onrender.com";
const SESSION_KEY = "attendance_saved_employee_v1";

function formatTime(isoString) {
  if (!isoString) return "--";
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(date = new Date()) {
  return date.toLocaleDateString([], {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatWorkedMinutes(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "--";
  const total = Number(minutes);
  const hours = Math.floor(total / 60);
  const balance = total % 60;
  if (hours === 0) return `${balance}m`;
  if (balance === 0) return `${hours}h`;
  return `${hours}h ${balance}m`;
}

function getInitials(name, fallback = "EM") {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  if (words.length === 1 && words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
  return String(fallback).slice(0, 2).toUpperCase();
}

function getStatusMeta(status) {
  if (status === "IN_OFFICE") {
    return {
      label: "Punched In",
      helper: "You are currently marked in office.",
      bg: "#E6F8EF",
      border: "#9EDFC0",
      text: "#167A4B"
    };
  }

  if (status === "CHECKED_OUT") {
    return {
      label: "Punched Out",
      helper: "Your day is completed successfully.",
      bg: "#FFF3E3",
      border: "#F2CC96",
      text: "#8D5A17"
    };
  }

  return {
    label: "Not Punched In",
    helper: "Start your shift by punching in.",
    bg: "#EAF4FF",
    border: "#B7D9FA",
    text: "#245F96"
  };
}

function getPerformanceMeta(performance) {
  const map = {
    ABSENT: { label: "Awaiting Punch In", color: "#647FA0" },
    ON_TIME: { label: "On Time", color: "#17834E" },
    LATE_IN: { label: "Late In", color: "#B9741B" },
    EARLY_OUT: { label: "Early Out", color: "#B9741B" },
    LATE_AND_EARLY: { label: "Late + Early", color: "#B05F2B" },
    IN_PROGRESS: { label: "In Progress", color: "#2E6FAA" },
    AUTO_CLOSED: { label: "Auto Closed", color: "#575FD4" }
  };
  return map[performance] ?? { label: performance, color: "#2E6FAA" };
}

function getCurrentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function getPreviousMonthValue() {
  const base = new Date(`${getCurrentMonthValue()}-01T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() - 1);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function App() {
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [employee, setEmployee] = useState(null);
  const [row, setRow] = useState(null);
  const [reportMonth, setReportMonth] = useState(getCurrentMonthValue());
  const [reportPayload, setReportPayload] = useState(null);
  const [activeSection, setActiveSection] = useState("home");
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState(null);

  const status = row?.status ?? "ABSENT";
  const statusMeta = useMemo(() => getStatusMeta(status), [status]);
  const performanceMeta = useMemo(() => getPerformanceMeta(row?.performance ?? "ABSENT"), [row?.performance]);
  const initials = useMemo(() => getInitials(employee?.name, employee?.id ?? "EM"), [employee?.name, employee?.id]);

  const canPunchIn = status === "ABSENT";
  const canPunchOut = status === "IN_OFFICE";

  function showNotice(message, type = "success") {
    setNotice({ message, type });
  }

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = setTimeout(() => setNotice(null), 2300);
    return () => clearTimeout(timeout);
  }, [notice]);

  async function callApi(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Something went wrong");
    }
    return payload;
  }

  async function getCurrentLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });

      return {
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6))
      };
    } catch {
      return null;
    }
  }

  async function loadTodayStatus(currentEmployeeId) {
    const payload = await callApi(`/api/attendance/employee/${encodeURIComponent(currentEmployeeId)}/today`);
    setRow(payload.row);
  }

  async function loadMonthlyReport(currentEmployeeId, month) {
    setLoadingReport(true);
    try {
      const payload = await callApi(
        `/api/attendance/employee/${encodeURIComponent(currentEmployeeId)}/report?month=${encodeURIComponent(month)}`
      );
      setReportPayload(payload);
    } finally {
      setLoadingReport(false);
    }
  }

  async function persistSession(nextEmployee) {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(nextEmployee));
  }

  async function clearSession() {
    await AsyncStorage.removeItem(SESSION_KEY);
  }

  async function restoreSession() {
    try {
      const savedSession = await AsyncStorage.getItem(SESSION_KEY);
      if (!savedSession) {
        setLoadingSession(false);
        return;
      }

      const savedEmployee = JSON.parse(savedSession);
      if (!savedEmployee?.id) {
        await clearSession();
        setLoadingSession(false);
        return;
      }

      setEmployee(savedEmployee);
      await Promise.all([loadTodayStatus(savedEmployee.id), loadMonthlyReport(savedEmployee.id, reportMonth)]);
      setLoadingSession(false);
    } catch {
      await clearSession();
      setLoadingSession(false);
    }
  }

  async function handleFirstTimeLogin() {
    if (!employeeId.trim() || !pin.trim()) {
      showNotice("Enter employee ID and PIN.", "error");
      return;
    }

    setLoadingLogin(true);
    try {
      const payload = await callApi("/api/employees/login", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim().toUpperCase(),
          pin: pin.trim()
        })
      });

      setEmployee(payload.employee);
      await persistSession(payload.employee);
      await Promise.all([loadTodayStatus(payload.employee.id), loadMonthlyReport(payload.employee.id, reportMonth)]);
      setPin("");
      showNotice("Account saved. Open app daily and punch in/out.", "success");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setLoadingLogin(false);
    }
  }

  async function handlePunchIn() {
    if (!employee) return;
    setBusyAction("in");

    try {
      const location = await getCurrentLocation();
      const payload = await callApi("/api/attendance/check-in", {
        method: "POST",
        body: JSON.stringify({ employeeId: employee.id, location })
      });

      setRow(payload.record);
      showNotice("Punch in recorded.", "success");
      await loadMonthlyReport(employee.id, reportMonth);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handlePunchOut() {
    if (!employee) return;
    setBusyAction("out");

    try {
      const location = await getCurrentLocation();
      const payload = await callApi("/api/attendance/check-out", {
        method: "POST",
        body: JSON.stringify({ employeeId: employee.id, location })
      });

      setRow(payload.record);
      showNotice("Punch out recorded.", "success");
      await loadMonthlyReport(employee.id, reportMonth);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRefresh() {
    if (!employee) return;
    try {
      await Promise.all([loadTodayStatus(employee.id), loadMonthlyReport(employee.id, reportMonth)]);
      showNotice("Status refreshed.", "success");
    } catch (error) {
      showNotice(error.message, "error");
    }
  }

  async function switchToCurrentMonth() {
    if (!employee) return;
    const nextMonth = getCurrentMonthValue();
    setReportMonth(nextMonth);
    await loadMonthlyReport(employee.id, nextMonth);
  }

  async function switchToPreviousMonth() {
    if (!employee) return;
    const nextMonth = getPreviousMonthValue();
    setReportMonth(nextMonth);
    await loadMonthlyReport(employee.id, nextMonth);
  }

  useEffect(() => {
    restoreSession().catch(() => setLoadingSession(false));
  }, []);

  useEffect(() => {
    if (!employee) return undefined;

    const interval = setInterval(() => {
      loadTodayStatus(employee.id).catch(() => undefined);
    }, 15000);

    return () => clearInterval(interval);
  }, [employee]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.backdropOne} />
      <View style={styles.backdropTwo} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCard}>
            <Image source={require("./assets/logo.png")} style={styles.logoImage} />
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTop}>TRAX ATTENDANCE</Text>
              <Text style={styles.heroTitle}>Office Attendance App</Text>
              <Text style={styles.heroSub}>One-time login. Then daily punch in and punch out only.</Text>
            </View>
          </View>

          {loadingSession ? (
            <View style={styles.panel}>
              <ActivityIndicator size="large" color="#2D9BF0" />
              <Text style={styles.centerText}>Loading your saved account...</Text>
            </View>
          ) : !employee ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>First-Time Setup</Text>
              <Text style={styles.panelSub}>Enter employee ID and PIN once. App stays logged in on this device.</Text>

              <Text style={styles.inputLabel}>Employee ID</Text>
              <TextInput
                value={employeeId}
                onChangeText={setEmployeeId}
                autoCapitalize="characters"
                placeholder="EMP001 or 0000001"
                placeholderTextColor="#86A8CB"
                style={styles.input}
              />

              <Text style={styles.inputLabel}>PIN</Text>
              <TextInput
                value={pin}
                onChangeText={setPin}
                placeholder="4-digit PIN"
                keyboardType="number-pad"
                secureTextEntry
                placeholderTextColor="#86A8CB"
                style={styles.input}
              />

              <TouchableOpacity
                style={[styles.primaryButton, loadingLogin && styles.buttonDisabled]}
                onPress={handleFirstTimeLogin}
                disabled={loadingLogin}
              >
                {loadingLogin ? <ActivityIndicator color="#083256" /> : <Text style={styles.primaryText}>Save And Continue</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.panel}>
              <View style={styles.identityRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
                <View>
                  <Text style={styles.name}>{employee.name}</Text>
                  <Text style={styles.meta}>
                    ID {employee.id} | {employee.department}
                  </Text>
                </View>
              </View>

              <View style={styles.sectionTabs}>
                <TouchableOpacity
                  style={[styles.sectionTab, activeSection === "home" && styles.sectionTabActive]}
                  onPress={() => setActiveSection("home")}
                >
                  <Text style={[styles.sectionTabText, activeSection === "home" && styles.sectionTabTextActive]}>Home</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sectionTab, activeSection === "report" && styles.sectionTabActive]}
                  onPress={() => setActiveSection("report")}
                >
                  <Text style={[styles.sectionTabText, activeSection === "report" && styles.sectionTabTextActive]}>Report</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sectionTab, activeSection === "profile" && styles.sectionTabActive]}
                  onPress={() => setActiveSection("profile")}
                >
                  <Text style={[styles.sectionTabText, activeSection === "profile" && styles.sectionTabTextActive]}>Profile</Text>
                </TouchableOpacity>
              </View>

              {activeSection === "home" ? (
                <>
                  <Text style={styles.today}>{formatDateLabel()}</Text>

                  <View style={[styles.statusChip, { backgroundColor: statusMeta.bg, borderColor: statusMeta.border }]}>
                    <Text style={[styles.statusLabel, { color: statusMeta.text }]}>{statusMeta.label}</Text>
                    <Text style={styles.statusHelper}>{statusMeta.helper}</Text>
                  </View>

                  <View style={styles.metricsGrid}>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Punch In</Text>
                      <Text style={styles.metricValue}>{formatTime(row?.checkInAt)}</Text>
                    </View>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Punch Out</Text>
                      <Text style={styles.metricValue}>{formatTime(row?.checkOutAt)}</Text>
                    </View>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Worked</Text>
                      <Text style={styles.metricValue}>{formatWorkedMinutes(row?.workedMinutes)}</Text>
                    </View>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Performance</Text>
                      <Text style={[styles.metricValue, { color: performanceMeta.color }]}>{performanceMeta.label}</Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, !canPunchIn && styles.buttonDisabled]}
                    onPress={handlePunchIn}
                    disabled={!canPunchIn || busyAction.length > 0}
                  >
                    {busyAction === "in" ? <ActivityIndicator color="#083256" /> : <Text style={styles.primaryText}>Punch In</Text>}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.secondaryButton, !canPunchOut && styles.buttonDisabled]}
                    onPress={handlePunchOut}
                    disabled={!canPunchOut || busyAction.length > 0}
                  >
                    {busyAction === "out" ? <ActivityIndicator color="#184266" /> : <Text style={styles.secondaryText}>Punch Out</Text>}
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
                    <Text style={styles.refreshText}>Refresh</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {activeSection === "report" ? (
                <>
                  <View style={styles.reportHeadRow}>
                    <Text style={styles.panelTitle}>Month Report ({reportMonth})</Text>
                    <View style={styles.reportActions}>
                      <TouchableOpacity style={styles.smallGhost} onPress={() => switchToCurrentMonth().catch((error) => showNotice(error.message, "error"))}>
                        <Text style={styles.smallGhostText}>Current</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallGhost} onPress={() => switchToPreviousMonth().catch((error) => showNotice(error.message, "error"))}>
                        <Text style={styles.smallGhostText}>Previous</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {loadingReport ? (
                    <ActivityIndicator color="#2D9BF0" />
                  ) : (
                    <>
                      <View style={styles.metricsGrid}>
                        <View style={styles.metricCard}>
                          <Text style={styles.metricLabel}>Records</Text>
                          <Text style={styles.metricValue}>{reportPayload?.summary?.records ?? 0}</Text>
                        </View>
                        <View style={styles.metricCard}>
                          <Text style={styles.metricLabel}>Worked</Text>
                          <Text style={styles.metricValue}>{formatWorkedMinutes(reportPayload?.summary?.totalWorkedMinutes ?? 0)}</Text>
                        </View>
                        <View style={styles.metricCard}>
                          <Text style={styles.metricLabel}>Late Days</Text>
                          <Text style={styles.metricValue}>{reportPayload?.summary?.lateDays ?? 0}</Text>
                        </View>
                        <View style={styles.metricCard}>
                          <Text style={styles.metricLabel}>Early Out</Text>
                          <Text style={styles.metricValue}>{reportPayload?.summary?.earlyDays ?? 0}</Text>
                        </View>
                      </View>

                      {(reportPayload?.rows ?? []).slice(-12).reverse().map((item) => (
                        <View key={item.date} style={styles.reportRow}>
                          <Text style={styles.reportDate}>{item.date}</Text>
                          <Text style={styles.reportMeta}>In {formatTime(item.checkInAt)} | Out {formatTime(item.checkOutAt)}</Text>
                          <Text style={styles.reportMeta}>Worked {formatWorkedMinutes(item.workedMinutes)}</Text>
                        </View>
                      ))}

                      {(reportPayload?.rows ?? []).length === 0 ? (
                        <Text style={styles.panelSub}>No attendance rows in selected month.</Text>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}

              {activeSection === "profile" ? (
                <View style={styles.profileWrap}>
                  <Text style={styles.panelTitle}>My Profile</Text>
                  <View style={styles.profileItem}>
                    <Text style={styles.profileLabel}>Name</Text>
                    <Text style={styles.profileValue}>{employee.name}</Text>
                  </View>
                  <View style={styles.profileItem}>
                    <Text style={styles.profileLabel}>Employee ID</Text>
                    <Text style={styles.profileValue}>{employee.id}</Text>
                  </View>
                  <View style={styles.profileItem}>
                    <Text style={styles.profileLabel}>Department</Text>
                    <Text style={styles.profileValue}>{employee.department}</Text>
                  </View>
                  <View style={styles.profileItem}>
                    <Text style={styles.profileLabel}>One-time Login</Text>
                    <Text style={styles.profileValue}>Enabled on this device</Text>
                  </View>
                </View>
              ) : null}
            </View>
          )}

          <Text style={styles.footer}>Server: {API_URL}</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {notice ? (
        <View style={[styles.notice, notice.type === "error" ? styles.noticeError : styles.noticeSuccess]}>
          <Text style={styles.noticeText}>{notice.message}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#EDF6FF"
  },
  flex: {
    flex: 1
  },
  backdropOne: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(107, 185, 255, 0.22)",
    top: -70,
    right: -90
  },
  backdropTwo: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(150, 219, 255, 0.24)",
    bottom: 40,
    left: -110
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 12
  },
  heroCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#CDE2F8",
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  logoImage: {
    width: 56,
    height: 56,
    borderRadius: 14
  },
  heroTextWrap: {
    flex: 1
  },
  heroTop: {
    color: "#2E6FA6",
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "800"
  },
  heroTitle: {
    color: "#123557",
    fontSize: 21,
    fontWeight: "800",
    marginTop: 2
  },
  heroSub: {
    color: "#5D7F9F",
    fontSize: 13,
    marginTop: 3
  },
  panel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#CDE2F8",
    padding: 16,
    gap: 12
  },
  panelTitle: {
    color: "#123557",
    fontWeight: "800",
    fontSize: 16
  },
  panelSub: {
    color: "#6283A4",
    fontSize: 13
  },
  centerText: {
    textAlign: "center",
    color: "#6384A5"
  },
  inputLabel: {
    color: "#3C6289",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4
  },
  input: {
    borderWidth: 1,
    borderColor: "#BFD9F3",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#14395C",
    backgroundColor: "#F7FBFF"
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#D8EEFF",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: "#124C7A",
    fontWeight: "800",
    fontSize: 16
  },
  name: {
    color: "#103655",
    fontSize: 18,
    fontWeight: "800"
  },
  meta: {
    color: "#5F81A2",
    fontSize: 12,
    marginTop: 2
  },
  sectionTabs: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#C6DEF5",
    borderRadius: 12,
    padding: 4,
    backgroundColor: "#F2F8FF"
  },
  sectionTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 9
  },
  sectionTabActive: {
    backgroundColor: "#86CCFF"
  },
  sectionTabText: {
    color: "#3A678E",
    fontWeight: "700",
    fontSize: 13
  },
  sectionTabTextActive: {
    color: "#0D3153"
  },
  today: {
    color: "#4C6E8F",
    fontWeight: "700",
    fontSize: 13
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
    gap: 3
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: "800"
  },
  statusHelper: {
    color: "#607E9A",
    fontSize: 12
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  metricCard: {
    width: "48%",
    backgroundColor: "#F6FBFF",
    borderWidth: 1,
    borderColor: "#CFE4F8",
    borderRadius: 12,
    padding: 10,
    gap: 4
  },
  metricLabel: {
    color: "#6787A7",
    fontSize: 11,
    fontWeight: "700"
  },
  metricValue: {
    color: "#153A5D",
    fontSize: 15,
    fontWeight: "800"
  },
  primaryButton: {
    marginTop: 2,
    backgroundColor: "#87D2FF",
    borderRadius: 13,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#77C8FA"
  },
  primaryText: {
    color: "#0A3256",
    fontWeight: "800"
  },
  secondaryButton: {
    backgroundColor: "#EAF5FF",
    borderRadius: 13,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#C3DDF4"
  },
  secondaryText: {
    color: "#214B72",
    fontWeight: "800"
  },
  refreshButton: {
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 12
  },
  refreshText: {
    color: "#2A6FA8",
    fontWeight: "700"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  reportHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  reportActions: {
    flexDirection: "row",
    gap: 6
  },
  smallGhost: {
    borderWidth: 1,
    borderColor: "#BFD9F2",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "#F3FAFF"
  },
  smallGhostText: {
    color: "#2B5B86",
    fontWeight: "700",
    fontSize: 12
  },
  reportRow: {
    borderWidth: 1,
    borderColor: "#D4E6F7",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#F9FCFF",
    gap: 2
  },
  reportDate: {
    color: "#1C4B73",
    fontWeight: "800"
  },
  reportMeta: {
    color: "#6788A8",
    fontSize: 12
  },
  profileWrap: {
    gap: 8
  },
  profileItem: {
    borderWidth: 1,
    borderColor: "#D4E7F8",
    borderRadius: 12,
    backgroundColor: "#F8FCFF",
    padding: 10,
    gap: 3
  },
  profileLabel: {
    color: "#6384A4",
    fontSize: 11,
    fontWeight: "700"
  },
  profileValue: {
    color: "#143A5D",
    fontSize: 15,
    fontWeight: "800"
  },
  footer: {
    textAlign: "center",
    color: "#7092B4",
    fontSize: 11,
    paddingBottom: 8
  },
  notice: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1
  },
  noticeSuccess: {
    backgroundColor: "#E8FFF3",
    borderColor: "#9CE2BF"
  },
  noticeError: {
    backgroundColor: "#FFF0F3",
    borderColor: "#F1BFC7"
  },
  noticeText: {
    textAlign: "center",
    color: "#19436A",
    fontWeight: "700"
  }
});
