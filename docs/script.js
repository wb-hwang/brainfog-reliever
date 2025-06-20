'use strict';
const dom = {
    // 设置
    settingsPanel: document.getElementById('settings-panel'),
    totalDurationSelect: document.getElementById('total-duration'),
    holdDurationSelect: document.getElementById('hold-duration'),
    soundToggle: document.getElementById('sound-toggle'),
    // 计时器显示
    progressFg: document.getElementById('progress-fg'),
    phaseName: document.getElementById('phase-name'),
    timeLeft: document.getElementById('time-left'),
    phaseInstruction: document.getElementById('phase-instruction'),
    // 控制
    controlBtn: document.getElementById('control-btn'),
};

// 音频处理
const audio = {

    dingSound: 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA',
    context: null,
    buffer: null,
};

// 应用状态管理
const state = {
    // 配置
    config: {
        totalDuration: 240, // in seconds
        holdDuration: 4,    // in seconds
        breatheDuration: 15, // in seconds
        isSoundEnabled: false,
    },
    // 计时器内部状态
    timer: {
        isActive: false,
        // 'ready', 'breathe', 'hold', 'finished'
        currentPhase: 'ready',
        totalTimeElapsed: 0,
        phaseTimeElapsed: 0,
        // 用于requestAnimationFrame
        animationFrameId: null, 
        lastFrameTime: 0,
    },
    // UI状态
    ui: {
        // 'initial', 'running', 'paused', 'finished'
        controlButtonState: 'initial', 
        isSettingsVisible: true,
        // SVG进度环的周长
        progressCircleCircumference: 2 * Math.PI * dom.progressFg.r.baseVal.value,
    },
};

// 辅助函数
const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// 阶段中英文映射
const phaseTextMap = {
    'ready': { 
        zh: '准备', 
        en: 'Ready',
        instruction: '准备开始呼吸练习'
    },
    'breathe': { 
        zh: '呼吸', 
        en: 'Breathe',
        instruction: '通过鼻子平缓呼吸'
    },
    'hold': { 
        zh: '屏息', 
        en: 'Hold',
        instruction: '保持屏息，放松身体'
    },
    'finished': { 
        zh: '完成', 
        en: 'Done',
        instruction: '练习已完成，感觉如何？'
    }
};

// UI 更新函数
const updateUI = () => {
    const { config, timer, ui } = state;

    // 更新阶段名称和颜色（中英文）
    const phase = timer.currentPhase;
    const phaseText = phaseTextMap[phase] || { zh: '', en: '', instruction: '' };
    dom.phaseName.innerHTML = `<span style="font-size:1.1em">${phaseText.zh}</span><br><span style="font-size:0.8em;color:var(--color-text-light)">${phaseText.en}</span>`;
    dom.phaseInstruction.textContent = phaseText.instruction;
    
    let currentColorVar = 'var(--color-ready)';
    if (phase === 'breathe') currentColorVar = 'var(--color-breathe)';
    if (phase === 'hold') currentColorVar = 'var(--color-hold)';
    if (phase === 'finished') currentColorVar = 'var(--color-done)';
    dom.progressFg.style.stroke = currentColorVar;
    dom.phaseName.style.color = currentColorVar;
    dom.phaseInstruction.style.color = currentColorVar;
    
    // 更新倒计时
    let timeLeftInPhase;
    let phaseDuration;
    if (phase === 'breathe') {
        phaseDuration = config.breatheDuration;
        timeLeftInPhase = phaseDuration - timer.phaseTimeElapsed;
    } else if (phase === 'hold') {
        phaseDuration = config.holdDuration;
        timeLeftInPhase = phaseDuration - timer.phaseTimeElapsed;
    } else {
        // 'ready' or 'finished'
        timeLeftInPhase = config.totalDuration - timer.totalTimeElapsed;
        phaseDuration = config.totalDuration;
        dom.timeLeft.textContent = formatTime(timeLeftInPhase);
    }
    
    if (phase === 'breathe' || phase === 'hold') {
        dom.timeLeft.textContent = Math.ceil(timeLeftInPhase).toString();
    }

    // 更新SVG进度条
    const progress = phaseDuration > 0 ? timer.phaseTimeElapsed / phaseDuration : 0;
    const offset = ui.progressCircleCircumference * (1 - progress);
    dom.progressFg.style.strokeDasharray = `${ui.progressCircleCircumference}`;
    dom.progressFg.style.strokeDashoffset = offset;

    // 更新按钮状态
    switch(ui.controlButtonState) {
        case 'initial':
            dom.controlBtn.innerHTML = '<i class="fas fa-play"></i> 开始';
            break;
        case 'running':
            dom.controlBtn.innerHTML = '<i class="fas fa-pause"></i> 暂停';
            break;
        case 'paused':
            dom.controlBtn.innerHTML = '<i class="fas fa-play"></i> 继续';
            break;
        case 'finished':
            dom.controlBtn.innerHTML = '<i class="fas fa-redo"></i> 重新开始';
            break;
    }
    
    // 更新设置面板可见性
    dom.settingsPanel.classList.toggle('hidden', !ui.isSettingsVisible);

    // 更新动画效果
    const timerEl = document.querySelector('.timer');
    timerEl.classList.remove('breathe-active', 'hold-active');
    
    if (timer.isActive) {
        if (phase === 'breathe') {
            timerEl.classList.add('breathe-active');
        } else if (phase === 'hold') {
            timerEl.classList.add('hold-active');
        }
    }
};

// 核心计时器循环
function loop(timestamp) {
    if (!state.timer.isActive) return;

    // 初始化 lastFrameTime
    if (!state.timer.lastFrameTime) {
        state.timer.lastFrameTime = timestamp;
    }

    // 计算时间增量，确保精确性
    const deltaTime = (timestamp - state.timer.lastFrameTime) / 1000; // convert to seconds
    state.timer.lastFrameTime = timestamp;

    state.timer.totalTimeElapsed += deltaTime;
    state.timer.phaseTimeElapsed += deltaTime;

    const { config, timer } = state;
    const currentPhaseDuration = timer.currentPhase === 'breathe' ? config.breatheDuration : config.holdDuration;

    // 检查总时长是否结束
    if (timer.totalTimeElapsed >= config.totalDuration) {
        finishTimer();
        return; // 停止循环
    }

    // 检查阶段是否结束
    if (timer.phaseTimeElapsed >= currentPhaseDuration) {
        timer.phaseTimeElapsed -= currentPhaseDuration; // 保留多余的时间以提高精度

        if (timer.currentPhase === 'breathe') {
            timer.currentPhase = 'hold';
            if (config.isSoundEnabled) playDingSound(); // 播放声音提示
        } else if (timer.currentPhase === 'hold') {
            timer.currentPhase = 'breathe';
        }
    }
    
    // 请求UI更新并将状态同步到视图
    updateUI();

    // 请求下一帧
    state.timer.animationFrameId = requestAnimationFrame(loop);
}

// 7. 计时器控制函数 (High Cohesion)
async function playDingSound() {
    // 遵循浏览器策略，在用户交互后创建AudioContext
    if (!audio.context) {
        audio.context = new (window.AudioContext || window.webkitAudioContext)();
    }
    // 解码一次并缓存
    if (!audio.buffer) {
        const response = await fetch(audio.dingSound);
        const arrayBuffer = await response.arrayBuffer();
        audio.buffer = await audio.context.decodeAudioData(arrayBuffer);
    }
    
    // 播放声音
    const source = audio.context.createBufferSource();
    source.buffer = audio.buffer;
    source.connect(audio.context.destination);
    source.start(0);
}

function startTimer() {
    const { timer, ui } = state;
    timer.isActive = true;
    timer.lastFrameTime = 0; // 重置 lastFrameTime
    
    if (ui.controlButtonState === 'initial' || ui.controlButtonState === 'finished') {
        timer.currentPhase = 'breathe';
        timer.totalTimeElapsed = 0;
        timer.phaseTimeElapsed = 0;
    }

    ui.controlButtonState = 'running';
    ui.isSettingsVisible = false;
    
    // 禁用设置
    dom.totalDurationSelect.disabled = true;
    dom.holdDurationSelect.disabled = true;
    dom.soundToggle.disabled = true;

    state.timer.animationFrameId = requestAnimationFrame(loop);
}

function pauseTimer() {
    state.timer.isActive = false;
    state.ui.controlButtonState = 'paused';
    cancelAnimationFrame(state.timer.animationFrameId);
    updateUI(); // 确保UI在暂停时更新为最终状态
}

function finishTimer() {
    state.timer.isActive = false;
    state.timer.currentPhase = 'finished';
    state.ui.controlButtonState = 'finished';
    state.ui.isSettingsVisible = true;
    
    // 启用设置
    dom.totalDurationSelect.disabled = false;
    dom.holdDurationSelect.disabled = false;
    dom.soundToggle.disabled = false;

    cancelAnimationFrame(state.timer.animationFrameId);
    updateUI();
}

function resetTimer() {
    const { timer, ui, config } = state;
    timer.isActive = false;
    timer.currentPhase = 'ready';
    timer.totalTimeElapsed = 0;
    timer.phaseTimeElapsed = 0;
    
    ui.controlButtonState = 'initial';
    ui.isSettingsVisible = true;

    // 启用设置
    dom.totalDurationSelect.disabled = false;
    dom.holdDurationSelect.disabled = false;
    dom.soundToggle.disabled = false;
    
    cancelAnimationFrame(state.timer.animationFrameId);
    
    // 从下拉框重新读取配置并更新UI
    config.totalDuration = Number(dom.totalDurationSelect.value);
    config.holdDuration = Number(dom.holdDurationSelect.value);
    
    updateUI();
}

// 8. 事件监听器 (Controller)
function handleControlButtonClick() {
    const { ui } = state;
    if (ui.controlButtonState === 'initial' || ui.controlButtonState === 'paused') {
        startTimer();
    } else if (ui.controlButtonState === 'running') {
        pauseTimer();
    } else if (ui.controlButtonState === 'finished') {
        resetTimer();
    }
}

function addEventListeners() {
    dom.controlBtn.addEventListener('click', handleControlButtonClick);
    dom.totalDurationSelect.addEventListener('change', resetTimer);
    dom.holdDurationSelect.addEventListener('change', resetTimer);
    dom.soundToggle.addEventListener('change', (e) => {
        state.config.isSoundEnabled = e.target.checked;
    });
}

// 应用程序初始化入口
function init() {
    addEventListeners();
    resetTimer(); // 使用resetTimer进行初始化，确保状态一致
}

init();
