import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Switch,
  Alert,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Platform
} from 'react-native';
import { Audio } from 'expo-av';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Task Name for Expo Background Fetch
const BACKGROUND_FETCH_TASK = 'BACKGROUND_FOREX_PRICE_CHECK';

// Default Alpha Vantage API Key placeholder
const DEFAULT_API_KEY = 'YOUR_ALPHA_VANTAGE_API_KEY';

// Default initial FX pairs with spot rates
const DEFAULT_PAIRS = [
  { symbol: 'EUR/USD', price: 1.0850, decimals: 4 },
  { symbol: 'GBP/USD', price: 1.2640, decimals: 4 },
  { symbol: 'USD/JPY', price: 154.20, decimals: 2 },
  { symbol: 'AUD/USD', price: 0.6530, decimals: 4 },
  { symbol: 'USD/CHF', price: 0.8840, decimals: 4 },
  { symbol: 'USD/CAD', price: 1.3520, decimals: 4 },
];

// Initial Alarms Demo Data
const INITIAL_ALARMS = [
  { id: '101', pair: 'EUR/USD', targetPrice: 1.0880, direction: 'ABOVE', enabled: true, triggered: false },
  { id: '102', pair: 'EUR/USD', targetPrice: 1.0820, direction: 'BELOW', enabled: true, triggered: false },
];

// Available sound profiles for audio alerts
const SOUND_PROFILES = [
  { id: 'siren', name: 'Sirena Aguda', freq: 880 },
  { id: 'beeper', name: 'Pitido Doble', freq: 750 },
  { id: 'sonar', name: 'Pulso Sonar', freq: 440 },
  { id: 'alarm', name: 'Alarma Submarino', freq: 300 }
];

// ---------------------------------------------------------------------------
// 1. BACKGROUND TASK DEFINITION
// ---------------------------------------------------------------------------
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    const rawAlarms = await AsyncStorage.getItem('@forex_alarms');
    const apiKey = (await AsyncStorage.getItem('@forex_api_key')) || DEFAULT_API_KEY;

    if (!rawAlarms) return BackgroundFetch.BackgroundFetchResult.NoData;
    const alarms = JSON.parse(rawAlarms);
    const activeAlarms = alarms.filter(a => a.enabled && !a.triggered);

    if (activeAlarms.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Get unique pairs that need background updates
    const activePairs = [...new Set(activeAlarms.map(a => a.pair))];

    for (const pairSymbol of activePairs) {
      const [fromCurr, toCurr] = pairSymbol.split('/');
      const response = await fetch(
        `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurr}&to_currency=${toCurr}&apikey=${apiKey}`
      );
      const data = await response.json();
      
      if (data['Realtime Currency Exchange Rate']) {
        const livePrice = parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
        
        // Evaluate alarms
        for (let alarm of alarms) {
          if (alarm.pair === pairSymbol && alarm.enabled && !alarm.triggered) {
            let triggered = false;
            if (alarm.direction === 'ABOVE' && livePrice >= alarm.targetPrice) triggered = true;
            if (alarm.direction === 'BELOW' && livePrice <= alarm.targetPrice) triggered = true;

            if (triggered) {
              alarm.triggered = true;
              alarm.enabled = false; // Disable on trigger
            }
          }
        }
      }
    }

    await AsyncStorage.setItem('@forex_alarms', JSON.stringify(alarms));
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (err) {
    console.error('Background fetch error:', err);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Register background task helper
async function registerBackgroundFetchAsync() {
  return BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: 15 * 60, // 15 mins minimum interval for Expo Background Fetch
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

// ---------------------------------------------------------------------------
// 2. MAIN REACT NATIVE APP COMPONENT
// ---------------------------------------------------------------------------
export default function App() {
  const [pairs, setPairs] = useState(DEFAULT_PAIRS);
  const [alarms, setAlarms] = useState(INITIAL_ALARMS);
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [refreshInterval, setRefreshInterval] = useState(5); // in seconds
  const [selectedSound, setSelectedSound] = useState('siren');
  const [activeTrigger, setActiveTrigger] = useState(null);
  
  // UI Controls & Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingAlarmId, setEditingAlarmId] = useState(null);
  
  // Form State
  const [formPair, setFormPair] = useState('EUR/USD');
  const [formTargetPrice, setFormTargetPrice] = useState('');
  const [formDirection, setFormDirection] = useState('ABOVE');

  // Sound ref for expo-av audio playing
  const soundRef = useRef(null);

  // Initialize storage & background execution
  useEffect(() => {
    loadSettings();
    registerBackgroundFetchAsync();
    
    // Audio setup
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    return () => {
      stopAlarmSound();
    };
  }, []);

  // Save Alarms to AsyncStorage whenever updated
  useEffect(() => {
    AsyncStorage.setItem('@forex_alarms', JSON.stringify(alarms));
  }, [alarms]);

  const loadSettings = async () => {
    try {
      const savedKey = await AsyncStorage.getItem('@forex_api_key');
      const savedAlarms = await AsyncStorage.getItem('@forex_alarms');
      if (savedKey) setApiKey(savedKey);
      if (savedAlarms) setAlarms(JSON.parse(savedAlarms));
    } catch (e) {
      console.error('Error loading settings', e);
    }
  };

  // --- AUDIO SOUND PLAYER (EXPO-AV) ---
  const playAlarmSound = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Continuous alarm playback using expo-av loop
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://actions.google.com/sounds/v1/alarms/alarm_clock_short.ogg' },
        { shouldPlay: true, isLooping: true }
      );
      soundRef.current = sound;
    } catch (err) {
      console.log('Audio Playback Error: ', err);
    }
  };

  const stopAlarmSound = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      } catch (err) {
        console.log('Audio Stop Error: ', err);
      }
    }
  };

  // --- LIVE MARKET POLLING / FETCH (ALPHA VANTAGE) ---
  useEffect(() => {
    const interval = setInterval(async () => {
      // Simulate live price micro ticks for testing
      setPairs(prevPairs =>
        prevPairs.map(p => {
          const delta = (Math.random() - 0.495) * 0.0012;
          const newPrice = parseFloat(Math.max(0.0001, p.price * (1 + delta)).toFixed(p.decimals));
          return { ...p, price: newPrice };
        })
      );
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  // --- CHECK ALARM THRESHOLDS ---
  useEffect(() => {
    alarms.forEach(alarm => {
      if (!alarm.enabled || alarm.triggered) return;

      const currentPair = pairs.find(p => p.symbol === alarm.pair);
      if (!currentPair) return;

      let isTriggered = false;
      if (alarm.direction === 'ABOVE' && currentPair.price >= alarm.targetPrice) isTriggered = true;
      if (alarm.direction === 'BELOW' && currentPair.price <= alarm.targetPrice) isTriggered = true;

      if (isTriggered) {
        setAlarms(prev =>
          prev.map(a => (a.id === alarm.id ? { ...a, triggered: true, enabled: false } : a))
        );
        setActiveTrigger({
          alarm,
          pairPrice: currentPair.price,
        });
        playAlarmSound();
      }
    });
  }, [pairs, alarms]);

  // --- HANDLERS ---
  const handleOpenCreateModal = () => {
    setEditingAlarmId(null);
    setFormPair(pairs[0]?.symbol || 'EUR/USD');
    setFormTargetPrice((pairs[0]?.price || 1.0850).toString());
    setFormDirection('ABOVE');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (alarm) => {
    setEditingAlarmId(alarm.id);
    setFormPair(alarm.pair);
    setFormTargetPrice(alarm.targetPrice.toString());
    setFormDirection(alarm.direction);
    setIsModalOpen(true);
  };

  const handleSaveAlarm = () => {
    const parsedPrice = parseFloat(formTargetPrice);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Error', 'Ingrese un precio objetivo válido.');
      return;
    }

    if (editingAlarmId) {
      setAlarms(prev =>
        prev.map(a =>
          a.id === editingAlarmId
            ? { ...a, pair: formPair, targetPrice: parsedPrice, direction: formDirection, enabled: true, triggered: false }
            : a
        )
      );
    } else {
      const newAlarm = {
        id: Date.now().toString(),
        pair: formPair,
        targetPrice: parsedPrice,
        direction: formDirection,
        enabled: true,
        triggered: false,
      };
      setAlarms(prev => [...prev, newAlarm]);
    }

    setIsModalOpen(false);
  };

  const confirmDeleteAlarm = (alarmId) => {
    Alert.alert(
      'Confirmar eliminación',
      '¿Estás seguro de que deseas eliminar esta alarma?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => setAlarms(prev => prev.filter(a => a.id !== alarmId))
        }
      ]
    );
  };

  const dismissTriggerAlert = async () => {
    await stopAlarmSound();
    setActiveTrigger(null);
  };

  const adjustFormPrice = (delta) => {
    const currentVal = parseFloat(formTargetPrice) || 1.0000;
    const newVal = Math.max(0.0001, currentVal + delta);
    setFormTargetPrice(newVal.toFixed(4));
  };

  const forcePriceBump = (pairSymbol, direction) => {
    setPairs(prev =>
      prev.map(p => {
        if (p.symbol === pairSymbol) {
          const factor = direction === 'UP' ? 1.0025 : 0.9975;
          return { ...p, price: parseFloat((p.price * factor).toFixed(p.decimals)) };
        }
        return p;
      })
    );
  };

  // Build sorted unified list (Only include pairs with alarms)
  const sortedPairs = [...pairs].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const unifiedDisplayList = [];

  sortedPairs.forEach(pairObj => {
    const pairAlarms = alarms.filter(a => a.pair === pairObj.symbol);
    if (pairAlarms.length === 0) return;

    const items = [
      ...pairAlarms.map(a => ({ type: 'ALARM', id: `alarm-${a.id}`, data: a, priceVal: a.targetPrice })),
      { type: 'LIVE_PRICE', id: `live-price-${pairObj.symbol}`, priceVal: pairObj.price }
    ].sort((a, b) => b.priceVal - a.priceVal);

    unifiedDisplayList.push({ pairObj, items });
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>FX ALERT TERMINAL</Text>
          <Text style={styles.headerSub}>Alpha Vantage & Background Engine</Text>
        </View>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => setIsSettingsOpen(true)}>
          <Text style={styles.settingsBtnText}>⚙ Config</Text>
        </TouchableOpacity>
      </View>

      {/* MAIN ALARM LIST */}
      <ScrollView style={styles.scrollArea}>
        {unifiedDisplayList.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Sin Alertas Activas</Text>
            <Text style={styles.emptyText}>Crea una alarma para monitorear un par de divisas.</Text>
            <TouchableOpacity style={styles.createBtn} onPress={handleOpenCreateModal}>
              <Text style={styles.createBtnText}>+ Crear Alarma</Text>
            </TouchableOpacity>
          </View>
        ) : (
          unifiedDisplayList.map(({ pairObj, items }) => (
            <View key={pairObj.symbol} style={styles.pairCard}>
              <View style={styles.pairHeader}>
                <Text style={styles.pairTitle}>{pairObj.symbol}</Text>
                <View style={styles.bumpContainer}>
                  <TouchableOpacity
                    style={[styles.bumpBtn, styles.bumpUp]}
                    onPress={() => forcePriceBump(pairObj.symbol, 'UP')}
                  >
                    <Text style={styles.bumpUpText}>+0.25%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.bumpBtn, styles.bumpDown]}
                    onPress={() => forcePriceBump(pairObj.symbol, 'DOWN')}
                  >
                    <Text style={styles.bumpDownText}>-0.25%</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {items.map(item => {
                if (item.type === 'LIVE_PRICE') {
                  return (
                    <View key={item.id} style={styles.livePriceRow}>
                      <Text style={styles.livePriceLabel}>● Spot Actual</Text>
                      <Text style={styles.livePriceVal}>{item.priceVal.toFixed(pairObj.decimals)}</Text>
                    </View>
                  );
                }

                const alarm = item.data;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.alarmRow, !alarm.enabled && styles.alarmDisabled]}
                    onPress={() => handleOpenEditModal(alarm)}
                  >
                    <View style={styles.alarmInfo}>
                      <Text style={[styles.directionBadge, alarm.direction === 'ABOVE' ? styles.above : styles.below]}>
                        {alarm.direction}
                      </Text>
                      <Text style={styles.targetPriceText}>{alarm.targetPrice.toFixed(pairObj.decimals)}</Text>
                    </View>

                    <View style={styles.alarmActions}>
                      <Switch
                        value={alarm.enabled}
                        onValueChange={val =>
                          setAlarms(prev => prev.map(a => (a.id === alarm.id ? { ...a, enabled: val } : a)))
                        }
                        trackColor={{ false: '#334155', true: '#0891b2' }}
                      />
                      <TouchableOpacity onPress={() => confirmDeleteAlarm(alarm.id)}>
                        <Text style={styles.deleteText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {/* FAB BUTTON */}
      <TouchableOpacity style={styles.fab} onPress={handleOpenCreateModal}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* TRIGGER ALARM OVERLAY MODAL */}
      {activeTrigger && (
        <Modal transparent animationType="fade" visible={!!activeTrigger}>
          <View style={styles.alertOverlay}>
            <View style={styles.alertBox}>
              <Text style={styles.alertTitle}>¡ALERTA DISPARADA!</Text>
              <Text style={styles.alertBody}>
                {activeTrigger.alarm.pair} alcanzó {activeTrigger.pairPrice}
              </Text>
              <TouchableOpacity style={styles.alertDismissBtn} onPress={dismissTriggerAlert}>
                <Text style={styles.alertDismissText}>Detener Alarma</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* ADD / EDIT ALARM MODAL */}
      <Modal visible={isModalOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingAlarmId ? 'Editar Alarma' : 'Crear Alarma'}</Text>

            <Text style={styles.label}>Par de Divisas</Text>
            <View style={styles.pickerContainer}>
              {pairs.map(p => (
                <TouchableOpacity
                  key={p.symbol}
                  style={[styles.pickerItem, formPair === p.symbol && styles.pickerItemActive]}
                  onPress={() => setFormPair(p.symbol)}
                >
                  <Text style={styles.pickerText}>{p.symbol}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Condición</Text>
            <View style={styles.directionRow}>
              <TouchableOpacity
                style={[styles.dirBtn, formDirection === 'ABOVE' && styles.dirBtnActive]}
                onPress={() => setFormDirection('ABOVE')}
              >
                <Text style={styles.dirBtnText}>POR ENCIMA</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dirBtn, formDirection === 'BELOW' && styles.dirBtnActive]}
                onPress={() => setFormDirection('BELOW')}
              >
                <Text style={styles.dirBtnText}>POR DEBAJO</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Precio Objetivo</Text>
            <TextInput
              style={styles.priceInput}
              keyboardType="decimal-pad"
              value={formTargetPrice}
              onChangeText={setFormTargetPrice}
            />

            {/* Stepper horizontal precision controls */}
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustFormPrice(-0.01)}>
                <Text style={styles.stepBtnText}>-0.01</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustFormPrice(-0.0001)}>
                <Text style={styles.stepBtnText}>-0.0001</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustFormPrice(0.0001)}>
                <Text style={styles.stepBtnText}>+0.0001</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustFormPrice(0.01)}>
                <Text style={styles.stepBtnText}>+0.01</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsModalOpen(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAlarm}>
                <Text style={styles.saveBtnText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SETTINGS MODAL */}
      <Modal visible={isSettingsOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Configuración</Text>

            <Text style={styles.label}>Alpha Vantage API Key</Text>
            <TextInput
              style={styles.priceInput}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="API Key"
            />

            <Text style={styles.label}>Tono de Alarma</Text>
            {SOUND_PROFILES.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.soundItem, selectedSound === s.id && styles.soundItemActive]}
                onPress={() => setSelectedSound(s.id)}
              >
                <Text style={styles.soundText}>{s.name}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => {
                AsyncStorage.setItem('@forex_api_key', apiKey);
                setIsSettingsOpen(false);
              }}
            >
              <Text style={styles.saveBtnText}>Guardar Configuración</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// 3. STYLES
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  header: { padding: 16, backgroundColor: '#0f172a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#f8fafc', fontSize: 16, fontWeight: 'bold' },
  headerSub: { color: '#64748b', fontSize: 10 },
  settingsBtn: { backgroundColor: '#1e293b', padding: 8, borderRadius: 8 },
  settingsBtnText: { color: '#38bdf8', fontSize: 12, fontWeight: 'bold' },
  scrollArea: { flex: 1, padding: 12 },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyTitle: { color: '#f8fafc', fontSize: 16, fontWeight: 'bold' },
  emptyText: { color: '#64748b', fontSize: 12, textAlign: 'center', marginTop: 8 },
  createBtn: { marginTop: 16, backgroundColor: '#0891b2', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  createBtnText: { color: '#fff', fontWeight: 'bold' },
  pairCard: { backgroundColor: '#0f172a', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1e293b' },
  pairHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  pairTitle: { color: '#67e8f9', fontSize: 14, fontWeight: 'bold' },
  bumpContainer: { flexDirection: 'row', gap: 6 },
  bumpBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1 },
  bumpUp: { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)' },
  bumpDown: { backgroundColor: 'rgba(244,63,94,0.1)', borderColor: 'rgba(244,63,94,0.3)' },
  bumpUpText: { color: '#34d399', fontSize: 10, fontWeight: 'bold' },
  bumpDownText: { color: '#fb7185', fontSize: 10, fontWeight: 'bold' },
  livePriceRow: { backgroundColor: 'rgba(16,185,129,0.15)', borderYWidth: 1, borderColor: '#10b981', padding: 6, borderRadius: 6, flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  livePriceLabel: { color: '#34d399', fontSize: 10, fontWeight: 'bold' },
  livePriceVal: { color: '#34d399', fontSize: 12, fontWeight: 'bold' },
  alarmRow: { backgroundColor: '#1e293b', padding: 10, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 2 },
  alarmDisabled: { opacity: 0.5 },
  alarmInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  directionBadge: { fontSize: 9, fontWeight: 'bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  above: { backgroundColor: 'rgba(16,185,129,0.2)', color: '#34d399' },
  below: { backgroundColor: 'rgba(244,63,94,0.2)', color: '#fb7185' },
  targetPriceText: { color: '#f8fafc', fontSize: 12, fontWeight: 'bold' },
  alarmActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deleteText: { color: '#f43f5e', fontSize: 16, fontWeight: 'bold' },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 52, height: 52, borderRadius: 26, backgroundColor: '#06b6d4', justifyContent: 'center', alignItems: 'center', elevation: 8 },
  fabText: { color: '#020617', fontSize: 28, fontWeight: 'bold' },
  alertOverlay: { flex: 1, backgroundColor: 'rgba(2,6,23,0.9)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  alertBox: { backgroundColor: '#0f172a', borderWidth: 2, borderColor: '#f43f5e', borderRadius: 16, padding: 24, alignItems: 'center', width: '100%' },
  alertTitle: { color: '#fb7185', fontSize: 18, fontWeight: 'bold' },
  alertBody: { color: '#f8fafc', fontSize: 14, marginVertical: 12 },
  alertDismissBtn: { backgroundColor: '#e11d48', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  alertDismissText: { color: '#fff', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#0f172a', borderRadius: 16, padding: 20 },
  modalTitle: { color: '#f8fafc', fontSize: 16, fontWeight: 'bold', marginBottom: 16 },
  label: { color: '#94a3b8', fontSize: 11, marginTop: 10, marginBottom: 4 },
  pickerContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickerItem: { padding: 6, borderRadius: 6, backgroundColor: '#1e293b' },
  pickerItemActive: { backgroundColor: '#0891b2' },
  pickerText: { color: '#fff', fontSize: 11 },
  directionRow: { flexDirection: 'row', gap: 8 },
  dirBtn: { flex: 1, padding: 8, borderRadius: 6, backgroundColor: '#1e293b', alignItems: 'center' },
  dirBtnActive: { backgroundColor: '#0891b2' },
  dirBtnText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  priceInput: { backgroundColor: '#1e293b', color: '#fff', borderRadius: 8, padding: 10, fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  stepperRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  stepBtn: { flex: 1, backgroundColor: '#1e293b', padding: 8, borderRadius: 6, alignItems: 'center' },
  stepBtnText: { color: '#38bdf8', fontSize: 10, fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  cancelBtn: { padding: 10 },
  cancelBtnText: { color: '#94a3b8' },
  saveBtn: { backgroundColor: '#0891b2', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  soundItem: { padding: 10, backgroundColor: '#1e293b', borderRadius: 6, marginBottom: 6 },
  soundItemActive: { borderColor: '#0891b2', borderWidth: 1 },
  soundText: { color: '#fff', fontSize: 12 }
});