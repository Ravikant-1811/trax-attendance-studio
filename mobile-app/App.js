import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://trax-attendance-backend.onrender.com";
const SESSION_KEY = "attendance_saved_employee_v1";

function formatTime(isoString) {
  if (!isoString) return "--";
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate() {
  return new Date().toLocaleDateString([], {
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

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  if (words.length === 1 && words[0].length >= 2) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return String(fallback).slice(0, 2).toUpperCase();
}

function getStatusMeta(status) {
  if (status === "IN_OFFICE") {
    return {
      label: "Punched In",
      helper: "You are currently marked in office.",
      bg: "#153D35",
      border: "#2A816C",
      text: "#9FEED7"
    };
  }

  if (status === "CHECKED_OUT") {
    return {
      label: "Punched Out",
      helper: "Your day is completed successfully.",
      bg: "#44331A",
      border: "#976A2A",
      text: "#FFD89D"
    };
  }

  return {
    label: "Not Punched In",
    helper: "Start your shift by punching in.",
    bg: "#1D2E45",
    border: "#365276",
    text: "#BED7F6"
  };
}

function getPerformanceMeta(performance) {
  const map = {
    ABSENT: { label: "Awaiting Punch In", color: "#9FB5D8" },
    ON_TIME: { label: "On Time", color: "#91E8CD" },
    LATE_IN: { label: "Late In", color: "#F4C07A" },
    EARLY_OUT: { label: "Early Out", color: "#E9A96B" },
    LATE_AND_EARLY: { label: "Late + Early", color: "#E7A26A" },
    IN_PROGRESS: { label: "In Progress", color: "#A8C8F5" },
    AUTO_CLOSED: { label: "Auto Closed", color: "#B9BCFF" }
  };
  return map[performance] ?? { label: performance, color: "#A8C8F5" };
}

export default function App() {
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [employee, setEmployee] = useState(null);
  const [row, setRow] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingLogin, setLoadingLogin] = useState(false);
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
    const timeout = setTimeout(() => setNotice(null), 2200);
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

  async function loadTodayStatus(currentEmployeeId) {
    const payload = await callApi(`/api/attendance/employee/${encodeURIComponent(currentEmployeeId)}/today`);
    setRow(payload.row);
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
      await loadTodayStatus(savedEmployee.id);
      setLoadingSession(false);
    } catch {
      await clearSession();
      setLoadingSession(false);
    }
  }

  async function handleFirstTimeLogin() {
    if (!employeeId.trim() || !pin.trim()) {
      Alert.alert("Missing details", "Enter employee ID and PIN.");
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
      await loadTodayStatus(payload.employee.id);
      setPin("");
      showNotice("Account saved. From now on just open app and punch.", "success");
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
      const payload = await callApi("/api/attendance/check-in", {
        method: "POST",
        body: JSON.stringify({ employeeId: employee.id })
      });

      setRow(payload.record);
      showNotice("Punch in recorded.", "success");
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
      const payload = await callApi("/api/attendance/check-out", {
        method: "POST",
        body: JSON.stringify({ employeeId: employee.id })
      });

      setRow(payload.record);
      showNotice("Punch out recorded.", "success");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  function openChangeAccountPrompt() {
    Alert.alert("Switch account?", "This will remove saved login and show setup screen again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Switch",
        style: "destructive",
        onPress: async () => {
          await clearSession();
          setEmployee(null);
          setRow(null);
          setEmployeeId("");
          setPin("");
          showNotice("Saved account removed.", "success");
        }
      }
    ]);
  }

  async function handleRefresh() {
    if (!employee) return;
    try {
      await loadTodayStatus(employee.id);
      showNotice("Status refreshed.", "success");
    } catch (error) {
      showNotice(error.message, "error");
    }
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
      <StatusBar barStyle="light-content" />
      <View style={styles.backdropOne} />
      <View style={styles.backdropTwo} />
      <View style={styles.backdropThree} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCard}>
            <Image source={require("./assets/logo.png")} style={styles.logoImage} />
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTop}>TRAX ATTENDANCE</Text>
              <Text style={styles.heroTitle}>Smart Punch Desk</Text>
              <Text style={styles.heroSub}>One-time ID/PIN setup. Every day simply punch in and punch out.</Text>
            </View>
          </View>

          {loadingSession ? (
            <View style={styles.panel}>
              <ActivityIndicator size="large" color="#8BDDC3" />
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
                placeholder="EMP001"
                placeholderTextColor="#7B95B7"
                style={styles.input}
              />

              <Text style={styles.inputLabel}>PIN</Text>
              <TextInput
                value={pin}
                onChangeText={setPin}
                placeholder="4-digit PIN"
                keyboardType="number-pad"
                secureTextEntry
                placeholderTextColor="#7B95B7"
                style={styles.input}
              />

              <TouchableOpacity
                style={[styles.primaryButton, loadingLogin && styles.buttonDisabled]}
                onPress={handleFirstTimeLogin}
                disabled={loadingLogin}
              >
                {loadingLogin ? (
                  <ActivityIndicator color="#072122" />
                ) : (
                  <Text style={styles.primaryText}>Save And Continue</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.panel}>
              <View style={styles.identityRow}>
                <View style={styles.identityLeft}>
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

                <TouchableOpacity style={styles.switchButton} onPress={openChangeAccountPrompt}>
                  <Text style={styles.switchText}>Switch</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.today}>{formatDate()}</Text>

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
                {busyAction === "in" ? (
                  <ActivityIndicator color="#072122" />
                ) : (
                  <Text style={styles.primaryText}>Punch In</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryButton, !canPunchOut && styles.buttonDisabled]}
                onPress={handlePunchOut}
                disabled={!canPunchOut || busyAction.length > 0}
              >
                {busyAction === "out" ? (
                  <ActivityIndicator color="#DCE9FF" />
                ) : (
                  <Text style={styles.secondaryText}>Punch Out</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
                <Text style={styles.refreshText}>Refresh Status</Text>
              </TouchableOpacity>
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
    backgroundColor: "#040C16"
  },
  flex: {
    flex: 1
  },
  backdropOne: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(71, 130, 255, 0.16)",
    top: -90,
    right: -110
  },
  backdropTwo: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(41, 211, 163, 0.14)",
    bottom: 80,
    left: -120
  },
  backdropThree: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(169, 118, 255, 0.1)",
    top: 280,
    right: 40
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 14
  },
  heroCard: {
    backgroundColor: "rgba(14, 27, 45, 0.92)",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(131, 170, 222, 0.32)",
    flexDirection: "row",
    alignItems: "center",
    gap: 14
  },
  logoImage: {
    width: 56,
    height: 56,
    borderRadius: 12
  },
  heroTextWrap: {
    flex: 1
  },
  heroTop: {
    color: "#95E8CE",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.3,
    fontSize: 10
  },
  heroTitle: {
    marginTop: 6,
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 26
  },
  heroSub: {
    marginTop: 4,
    color: "#B9CCE8"
  },
  panel: {
    backgroundColor: "rgba(12, 22, 36, 0.92)",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(126, 164, 216, 0.28)"
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#F2F7FF"
  },
  panelSub: {
    marginTop: 6,
    color: "#A9BFDF"
  },
  inputLabel: {
    marginTop: 12,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#8EABCF",
    fontWeight: "700"
  },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "rgba(129, 165, 214, 0.35)",
    borderRadius: 13,
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: "#EDF5FF",
    backgroundColor: "rgba(7, 16, 29, 0.78)"
  },
  identityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  identityLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#90D8FF",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: "#05263A",
    fontSize: 14,
    fontWeight: "800"
  },
  name: {
    fontSize: 21,
    fontWeight: "800",
    color: "#F1F7FF"
  },
  meta: {
    marginTop: 2,
    color: "#A8BFDF"
  },
  switchButton: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(160, 189, 225, 0.4)",
    backgroundColor: "rgba(28, 43, 66, 0.7)"
  },
  switchText: {
    color: "#D8E7FC",
    fontWeight: "700",
    fontSize: 12
  },
  today: {
    marginTop: 10,
    color: "#A9BFDF",
    fontWeight: "600"
  },
  statusChip: {
    marginTop: 12,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1
  },
  statusLabel: {
    fontWeight: "800",
    fontSize: 16
  },
  statusHelper: {
    marginTop: 3,
    color: "#C6D7EE"
  },
  metricsGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9
  },
  metricCard: {
    width: "48%",
    minHeight: 82,
    borderRadius: 14,
    padding: 11,
    borderWidth: 1,
    borderColor: "rgba(129, 165, 214, 0.28)",
    backgroundColor: "rgba(11, 20, 34, 0.8)"
  },
  metricLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#89A7D0",
    fontWeight: "700"
  },
  metricValue: {
    marginTop: 8,
    color: "#EDF5FF",
    fontSize: 18,
    fontWeight: "800"
  },
  primaryButton: {
    marginTop: 14,
    backgroundColor: "#86E4C6",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: "#2A466C",
    borderWidth: 1,
    borderColor: "rgba(138, 176, 227, 0.44)",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  primaryText: {
    color: "#062528",
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 0.3
  },
  secondaryText: {
    color: "#E5F0FF",
    fontWeight: "800",
    fontSize: 16
  },
  refreshButton: {
    marginTop: 12,
    alignItems: "center"
  },
  refreshText: {
    color: "#A7D1FF",
    fontWeight: "700"
  },
  centerText: {
    marginTop: 10,
    textAlign: "center",
    color: "#A8BFDF"
  },
  footer: {
    color: "#7494BC",
    textAlign: "center",
    fontSize: 11,
    marginBottom: 10
  },
  notice: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 26,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1
  },
  noticeSuccess: {
    backgroundColor: "rgba(25, 108, 81, 0.95)",
    borderColor: "rgba(141, 242, 206, 0.45)"
  },
  noticeError: {
    backgroundColor: "rgba(139, 49, 74, 0.95)",
    borderColor: "rgba(255, 170, 188, 0.45)"
  },
  noticeText: {
    color: "#F7FCFF",
    textAlign: "center",
    fontWeight: "700"
  }
});
