const robot = document.querySelector("#robot");
const form = document.querySelector("#commandForm");
const nameForm = document.querySelector("#nameForm");
const nameInput = document.querySelector("#nameInput");
const input = document.querySelector("#commandInput");
const reply = document.querySelector("#robotReply");
const listenBtn = document.querySelector("#listenBtn");
const stopBtn = document.querySelector("#stopBtn");
const memoryList = document.querySelector("#memoryList");
const modeBadge = document.querySelector("#modeBadge");
const moodBadge = document.querySelector("#moodBadge");
const motionBadge = document.querySelector("#motionBadge");
const lipSyncLayers = Array.from(document.querySelectorAll(".lip-sync"));
const faceFrames = Array.from(document.querySelectorAll(".portrait.face-frame"));
const talkingPortrait = document.querySelector("#talkingPortrait");
const smilePortrait = document.querySelector("#smilePortrait");
const answerPortrait = document.querySelector("#answerPortrait");
const danceVideo = document.querySelector("#danceVideo");
const walkVideo = document.querySelector("#walkVideo");
const danceMusic = document.querySelector("#danceMusic");
const outfitShellImage = document.querySelector(".outfit-shell .state-image");
const inlineVideos = [talkingPortrait, smilePortrait, answerPortrait, danceVideo, walkVideo].filter(Boolean);
inlineVideos.forEach((video) => {
  if ("playsInline" in video) {
    video.playsInline = true;
  }
  if ("webkitPlaysInline" in video) {
    video.webkitPlaysInline = true;
  }
});
let faceFrameTimer = null;
let currentFaceFrame = 0;
let currentPortraitMode = "static";
let currentListening = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let currentMood = "calm";
let currentMotion = "idle";
let commandCount = 0;
let lastDesktopMessage = "";
let userName = localStorage.getItem("aivaUserName") || "";
let femaleVoice = null;
let autoListen = false;
let isRecognizing = false;
let micStartedByUser = false;
let lastHeardAt = 0;
let lastHeardCommand = "";
let voicesLoaded = false;
let outfitIndex = 0;
let lipTimer = null;
let lipShapeIndex = 0;
let pauseListeningForSpeech = false;
let restartListeningSoon = () => {};
let activeUtterance = null;
let speechUnlocked = false;
let danceLocked = false;
let pendingMusicRetry = false;
let awaitingSearchQuery = false;
let lastOutfitImageIndex = -1;
const outfitImageChoices = ["Generated image 3.png", "Generated image 5.png", "Generated image 6.png"];
const pending3D = {
  motion: "idle",
  mood: "calm",
  turnAngle: 0,
  talking: false
};

const lipShapes = ["viseme-soft", "viseme-open", "viseme-wide", "viseme-round", "viseme-open", "viseme-closed"];

function updatePortraitVideos() {
  const videos = [talkingPortrait, smilePortrait, answerPortrait];
  const showTalking = robot.classList.contains("talking");
  const activeMode = showTalking ? "speech" : currentPortraitMode;
  let hasActiveVideo = false;

  videos.forEach((video) => {
    if (!video) {
      return;
    }
    const shouldShow =
      (video === talkingPortrait && activeMode === "speech") ||
      (video === smilePortrait && activeMode === "smile") ||
      (video === answerPortrait && activeMode === "answer");

    if (shouldShow) {
      hasActiveVideo = true;
    }

    video.classList.toggle("active", shouldShow);
    if (shouldShow) {
      const allowAudio = video === talkingPortrait;
      video.muted = !allowAudio;
      if (allowAudio) {
        video.volume = 1;
      }
      video.play().catch(() => {});
    } else {
      video.muted = true;
      video.pause();
      video.currentTime = 0;
    }
  });

  robot.classList.toggle("video-mode", hasActiveVideo);
}

function setPortraitMode(mode) {
  currentPortraitMode = mode;
  if (mode === "static") {
    pausePortraitVideos();
  }
  updatePortraitVideos();
}

function setLipShape(shape) {
  lipSyncLayers.forEach((layer) => {
    layer.classList.remove(...lipShapes);
    if (shape) {
      layer.classList.add(shape);
    }
  });
}

function startLipSync() {
  window.clearInterval(lipTimer);
  lipShapeIndex = 0;
  setLipShape(lipShapes[lipShapeIndex]);
  lipTimer = window.setInterval(() => {
    lipShapeIndex = (lipShapeIndex + 1) % lipShapes.length;
    setLipShape(lipShapes[lipShapeIndex]);
  }, 115);
}

function stopLipSync() {
  window.clearInterval(lipTimer);
  lipTimer = null;
  setLipShape("viseme-closed");
}

function setActiveFaceFrame(index) {
  faceFrames.forEach((frame, i) => {
    frame.classList.toggle("active", i === index);
  });
  currentFaceFrame = index;
}

function startFaceCycle() {
  if (!faceFrames.length) {
    return;
  }

  window.clearInterval(faceFrameTimer);
  currentFaceFrame = 0;
  setActiveFaceFrame(currentFaceFrame);
  faceFrameTimer = window.setInterval(() => {
    currentFaceFrame = (currentFaceFrame + 1) % faceFrames.length;
    setActiveFaceFrame(currentFaceFrame);
  }, 800);
}

function stopFaceCycle() {
  window.clearInterval(faceFrameTimer);
  faceFrameTimer = null;
}

function chooseRandomFaceFrame() {
  if (!faceFrames.length) {
    return 0;
  }
  return Math.floor(Math.random() * faceFrames.length);
}

function pausePortraitVideos() {
  [talkingPortrait, smilePortrait, answerPortrait].forEach((video) => {
    if (!video) {
      return;
    }
    video.pause();
    video.currentTime = 0;
    video.classList.remove("active");
  });
}

function showStaticFace(index = null) {
  if (index === null) {
    if (currentPortraitMode === "static" && currentFaceFrame >= 0) {
      index = currentFaceFrame;
    } else {
      index = chooseRandomFaceFrame();
    }
  }
  stopFaceCycle();
  pausePortraitVideos();
  setActiveFaceFrame(index);
  setPortraitMode("static");
  modeBadge.textContent = "ONLINE";
}

function setListening(isListening) {
  currentListening = isListening;
  robot.classList.toggle("listening", isListening);

  if (isListening) {
    if (!robot.classList.contains("talking")) {
      showStaticFace(chooseRandomFaceFrame());
    }
    updatePortraitVideos();
    modeBadge.textContent = "LISTENING";
    return;
  }

  if (!robot.classList.contains("talking")) {
    showStaticFace(chooseRandomFaceFrame());
    updatePortraitVideos();
  }
}

function setTalking(isTalking) {
  robot.classList.toggle("talking", isTalking);
  pending3D.talking = isTalking;
  window.aiva3D?.setTalking(isTalking);
  updatePortraitVideos();

  if (isTalking) {
    stopFaceCycle();
    setPortraitMode("speech");
    if (talkingPortrait) {
      talkingPortrait.currentTime = 0;
      talkingPortrait.play().catch(() => {});
    }
    startLipSync();
  } else {
    stopLipSync();
    showStaticFace(chooseRandomFaceFrame());
  }
}

const colors = {
  blue: "#00d5ff",
  pink: "#ff6fae",
  green: "#65e6a8",
  gold: "#ffd166",
  red: "#ff4d5d",
  purple: "#b68cff",
  white: "#f3fbff"
};

function setAccent(colorName) {
  const color = colors[colorName] || colors.blue;
  robot.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-soft", `${color}33`);
}

function setMood(mood) {
  robot.classList.remove(`mood-${currentMood}`);
  currentMood = mood;
  robot.classList.add(`mood-${currentMood}`);
  moodBadge.textContent = mood.toUpperCase();
  pending3D.mood = mood;
  window.aiva3D?.setMood(mood);
  if (!robot.classList.contains("talking")) {
    showStaticFace();
  }
}

function setMotion(motion, force = false) {
  if (danceLocked && currentMotion === "dance" && motion !== "dance" && !force) {
    return;
  }

  robot.classList.remove(`motion-${currentMotion}`);
  currentMotion = motion;
  robot.classList.add(`motion-${currentMotion}`);
  motionBadge.textContent = motion.toUpperCase();
  pending3D.motion = motion;
  window.aiva3D?.setMotion(motion);

  if (motion === "dance") {
    if (danceVideo) {
      danceVideo.currentTime = 0;
      danceVideo.play().catch(() => {});
    }
    if (walkVideo) {
      walkVideo.pause();
      walkVideo.currentTime = 0;
    }
    if (danceMusic) {
      danceMusic.muted = false;
      danceMusic.volume = 1;
      danceMusic.loop = true;
      danceMusic.currentTime = 0;
      danceMusic.play().catch((error) => {
        pendingMusicRetry = true;
        console.warn("Dance music playback failed:", error);
      });
    }
  } else {
    if (danceVideo) {
      danceVideo.pause();
      danceVideo.currentTime = 0;
    }
    if (walkVideo) {
      if (motion === "walk") {
        walkVideo.currentTime = 0;
        walkVideo.play().catch(() => {});
      } else {
        walkVideo.pause();
        walkVideo.currentTime = 0;
      }
    }
    if (danceMusic) {
      danceMusic.pause();
      danceMusic.currentTime = 0;
      pendingMusicRetry = false;
    }
  }
}

function tryResumeDanceMusicOnGesture() {
  if (!pendingMusicRetry || !danceMusic || currentMotion !== "dance") {
    return;
  }

  danceMusic.play().then(() => {
    pendingMusicRetry = false;
  }).catch(() => {});
}

function setTurnAngle(angle) {
  robot.style.setProperty("--turn-angle", `${angle}deg`);
  pending3D.turnAngle = angle;
  window.aiva3D?.setTurnAngle(angle);
}

function stopAiva(shouldSpeak = true) {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  window.clearTimeout(speak.stopTimer);
  setTalking(false);
  window.aiva3D?.stop();
  danceLocked = false;
  setTurnAngle(0);
  setMotion("idle", true);
  setMood("calm");
  modeBadge.textContent = isRecognizing ? "LISTENING" : "ONLINE";

  if (shouldSpeak) {
    speak(userName ? `${userName}, stopped.` : "Stopped.");
  } else {
    reply.textContent = "Stopped.";
  }
}

function showDesktopImage() {
  if (!["dance", "walk", "move", "turn360", "sit", "outfit", "shortskirt"].includes(currentMotion)) {
    return;
  }
  setMotion("idle");
}

function normalizeWakeCommand(transcript) {
  const cleaned = transcript
    .trim()
    .replace(/[!?]+/g, " ")
    .replace(/\s+/g, " ");

  const wakeName = "(?:lee|li|leigh|lea|aiva|a\\s*iva|a\\s*i\\s*v\\s*a|ai\\s*va|a\\s*va|ava|eva|iva|ayva|aiba|diva)";
  const wakePrefix = new RegExp(`^(?:(?:hey|hi|hello|ok|okay)\\s+)?${wakeName}\\b[\\s,.-]*(.*)$`, "i");
  const match = cleaned.match(wakePrefix);
  return match ? match[1].trim() : "";
}

function isLikelyDirectVoiceCommand(transcript) {
  return /^(?:360|three\s+sixty|dance|walk|move|sit|stop|wake|sleep|check|open|start|launch|close|quit|exit|search|google|email|mail|gmail|inbox|excel|word|teams?|outlook|notepad|explorer|browser|chrome|turn|rotate|change|wear|outfit|short\s+skirt|happy|serious|curious|calm|glow|color|introduce|who\s+are\s+you|read\s+my\s+emails|check\s+my\s+emails)\b/i.test(transcript.trim());
}

function normalizeVoiceWakeCommand(transcript) {
  const cleaned = transcript
    .trim()
    .replace(/[!?]+/g, " ")
    .replace(/\s+/g, " ");

  const wakeName = "(?:lee|li|leigh|lea|aiva|a\\s*iva|a\\s*i\\s*v\\s*a|ai\\s*va|a\\s*va|ava|eva|iva|ayva|aiba|diva)";
  const wakePrefix = new RegExp(`^(?:(?:hey|hi|hello|ok|okay)\\s+)?${wakeName}\\b[\\s,.-]*(.*)$`, "i");
  const match = cleaned.match(wakePrefix);
  return match ? match[1].trim() : "";
}

function stripOptionalWakePhrase(command) {
  return normalizeWakeCommand(command) || command.trim();
}

function promptSearchQuery() {
  const query = window.prompt("What should Lee search on Google?");
  if (!query) {
    return "";
  }
  return query.trim();
}

function changeOutfit() {
  outfitIndex = (outfitIndex + 1) % 4;
  robot.dataset.outfit = String(outfitIndex);
  if (outfitShellImage && outfitImageChoices.length) {
    let nextIndex = Math.floor(Math.random() * outfitImageChoices.length);
    if (outfitImageChoices.length > 1 && nextIndex === lastOutfitImageIndex) {
      nextIndex = (nextIndex + 1) % outfitImageChoices.length;
    }
    lastOutfitImageIndex = nextIndex;
    outfitShellImage.src = outfitImageChoices[nextIndex];
  }
  window.aiva3D?.changeOutfit();
}

window.addEventListener("aiva3d-ready", () => {
  window.aiva3D.setMood(pending3D.mood);
  window.aiva3D.setMotion(pending3D.motion);
  window.aiva3D.setTurnAngle(pending3D.turnAngle);
  window.aiva3D.setTalking(pending3D.talking);
});

function remember(command, response) {
  if (!memoryList) {
    return;
  }

  commandCount += 1;
  if (commandCount === 1) {
    memoryList.innerHTML = "";
  }

  const item = document.createElement("li");
  item.textContent = `${commandCount}. ${command} -> ${response}`;
  memoryList.prepend(item);

  while (memoryList.children.length > 5) {
    memoryList.lastElementChild.remove();
  }
}

function chooseFemaleVoice() {
  if (!("speechSynthesis" in window)) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();
  voicesLoaded = voices.length > 0;
  const preferredNames = [
    "microsoft zira",
    "microsoft jenny",
    "microsoft aria",
    "microsoft sonia",
    "microsoft natasha",
    "microsoft hazel",
    "microsoft susan",
    "microsoft eva",
    "jenny",
    "aria",
    "zira",
    "sonia",
    "natasha",
    "susan",
    "samantha",
    "victoria",
    "karen",
    "moira",
    "tessa",
    "veena",
    "female",
    "woman"
  ];
  const maleNames = [
    "david",
    "mark",
    "guy",
    "george",
    "richard",
    "james",
    "daniel",
    "male",
    "man"
  ];
  const isMaleVoice = (voice) => {
    const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    return maleNames.some((term) => name.includes(term));
  };
  const isFemaleVoice = (voice) => {
    const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    return preferredNames.some((term) => name.includes(term));
  };

  femaleVoice = voices.find((voice) => {
    return voice.lang.toLowerCase().startsWith("en") && isFemaleVoice(voice) && !isMaleVoice(voice);
  }) || voices.find((voice) => isFemaleVoice(voice) && !isMaleVoice(voice)) || null;

  return femaleVoice;
}

function unlockSpeechSynthesis() {
  if (!("speechSynthesis" in window) || speechUnlocked) {
    return;
  }

  try {
    window.speechSynthesis.cancel();
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    primer.rate = 1;
    primer.pitch = 1;
    primer.onend = () => {
      speechUnlocked = true;
    };
    primer.onerror = () => {
      speechUnlocked = false;
    };
    window.speechSynthesis.speak(primer);
    speechUnlocked = true;
  } catch {
    speechUnlocked = false;
  }
}

function speak(text, retryCount = 0) {
  reply.textContent = text;
  setTalking(true);

  if ("speechSynthesis" in window && !speechUnlocked) {
    unlockSpeechSynthesis();
  }

  if (recognizer && isRecognizing) {
    pauseListeningForSpeech = true;
    recognizer.stop();
  }

  window.clearTimeout(speak.stopTimer);

  if (!("speechSynthesis" in window)) {
    speak.stopTimer = window.setTimeout(() => {
      setTalking(false);
      if (pauseListeningForSpeech) {
        pauseListeningForSpeech = false;
        restartListeningSoon();
      }
    }, 1400);
    return;
  }

  const selectedVoice = femaleVoice || chooseFemaleVoice();
  if (!selectedVoice && !voicesLoaded && retryCount < 8) {
    window.setTimeout(() => speak(text, retryCount + 1), 250);
    return;
  }

  if (!selectedVoice) {
    console.warn("Lee did not find a female voice. Speech output is disabled to avoid using a non-female voice.");
    setTalking(false);
    if (pauseListeningForSpeech) {
      pauseListeningForSpeech = false;
      restartListeningSoon();
    }
    return;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();

  const utterance = new SpeechSynthesisUtterance(text);
  activeUtterance = utterance;
  let started = false;

  utterance.lang = "en-US";
  utterance.voice = selectedVoice;
  console.info(`Lee voice selected: ${selectedVoice.name}`);
  utterance.rate = 0.94;
  utterance.pitch = 1.28;
  utterance.volume = 1;
  utterance.onstart = () => {
    started = true;
  };
  utterance.onend = () => {
    if (activeUtterance !== utterance) {
      return;
    }
    activeUtterance = null;
    setTalking(false);
    if (pauseListeningForSpeech) {
      pauseListeningForSpeech = false;
      restartListeningSoon();
    }
  };
  utterance.onerror = () => {
    if (activeUtterance !== utterance) {
      return;
    }
    activeUtterance = null;
    setTalking(false);
    if (pauseListeningForSpeech) {
      pauseListeningForSpeech = false;
      restartListeningSoon();
    }
  };

  window.speechSynthesis.speak(utterance);

  window.setTimeout(() => {
    if (activeUtterance !== utterance || started) {
      return;
    }

    // Retry once using the same female voice only.
    window.speechSynthesis.cancel();
    const retryUtterance = new SpeechSynthesisUtterance(text);
    activeUtterance = retryUtterance;
    retryUtterance.lang = "en-US";
    retryUtterance.voice = selectedVoice;
    retryUtterance.rate = 0.94;
    retryUtterance.pitch = 1.28;
    retryUtterance.volume = 1;
    retryUtterance.onend = () => {
      if (activeUtterance !== retryUtterance) {
        return;
      }
      activeUtterance = null;
      setTalking(false);
      if (pauseListeningForSpeech) {
        pauseListeningForSpeech = false;
        restartListeningSoon();
      }
    };
    retryUtterance.onerror = () => {
      if (activeUtterance !== retryUtterance) {
        return;
      }
      activeUtterance = null;
      setTalking(false);
      if (pauseListeningForSpeech) {
        pauseListeningForSpeech = false;
        restartListeningSoon();
      }
    };
    window.speechSynthesis.speak(retryUtterance);
  }, 1200);
}

function personalize(text) {
  if (!userName) {
    return text;
  }
  if (/^(i|please|desktop|command|happy|focused|calm|curiosity|dancing|waving|scanning|guard|stopping|glow)/i.test(text)) {
    return `${userName}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }
  return text;
}

function welcomeMessage(name = "user") {
  return `Welcome, ${name}; I am Lee, your personal Android, I'm here to execute your commands.`;
}

async function askDesktop(command) {
  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, userName })
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function isDesktopCommand(text) {
  return [
    "open word",
    "excel",
    "open excel",
    "close excel",
    "write a letter",
    "draft a letter",
    "create a letter",
    "write an email",
    "send an email",
    "draft email",
    "open email",
    "open teams",
    "open team",
    "open outlook",
    "open notepad",
    "open explorer",
    "open file explorer",
    "explorer",
    "open browser",
    "open chrome",
    "check my emails",
    "check email",
    "check emails",
    "open my email",
    "open inbox",
    "search",
    "search the web for",
    "search web for",
    "look up",
    "lookup",
    "find",
    "google"
  ].some((phrase) => text.includes(phrase)) || /^(?:(?:open|start|launch|close|quit|exit|stop)\s+)?(?:excel|word|teams?|outlook|notepad|(?:file\s+)?explorer|chrome|browser|e-?mails?|mail|gmail|inbox)\b/i.test(text.trim());
}

function isWebSearchCommand(text) {
  return /(\bsearch\b|\bgoogle\b|\blook\s*up\b|\bfind\b)/i.test(text);
}

function isSearchPromptOnly(text) {
  return /^(?:search(?:\s+the\s+web)?|search\s+web|google|look\s*up|find)\s*(?:for)?\s*[,.!?]*\s*$/i.test(text.trim());
}

function extractInlineSearchQuery(command) {
  const cleaned = command.trim().replace(/[!?]+/g, " ").replace(/\s+/g, " ");
  const match = cleaned.match(/^(?:search(?:\s+the\s+web)?(?:\s+for)?|search\s+web\s+for|google|look\s*up|find)\s+(.+)$/i);
  return match ? match[1].trim(" .,") : "";
}

function isEmailShortcut(text) {
  return /^(?:e-?mails?|mail|gmail|inbox)\b/i.test(text.trim());
}

function isStopCommand(text) {
  return /\b(stop|stopped|stopping|halt|freeze|cancel|top|stap)\b/i.test(text);
}

function isMovementOverrideCommand(text) {
  return /\b(walk|move|sit|seat|sitting|turn|rotate|wave|scan|guard|sleep|wake|online|idle|outfit|skirt|short\s+skirt)\b/i.test(text);
}

function isPotentialDesktopAppCommand(text) {
  const cleaned = text.trim();
  if (!cleaned) {
    return false;
  }

  if (/^(?:open|start|launch|close|quit|exit|stop)\s+.+/i.test(cleaned)) {
    return true;
  }

  if (/^[a-z][a-z0-9 ._-]{2,40}$/i.test(cleaned)) {
    return !/^(?:dance|walk|move|sit|sleep|wake|stop|search|google|email|mail|gmail|inbox|outfit|short\s+skirt|turn|rotate|wave|scan|guard|happy|serious|curious|calm|glow|color|introduce|who\s+are\s+you)\b/i.test(cleaned);
  }

  return false;
}

async function obey(rawCommand) {
  const command = rawCommand.trim();
  const text = command.toLowerCase();
  if (!command) {
    speak(userName ? `${userName}, please give me a command.` : "Please tell me your name, then give me a command.");
    return;
  }

  let response = "Command accepted.";

  const nameMatch = text.match(/\b(?:my name is|i am|i'm|call me)\s+([a-z][a-z .'-]{1,40})$/i);
  if (isStopCommand(text)) {
    awaitingSearchQuery = false;
    stopAiva(true);
    remember(command, "Stopped.");
    return;
  } else if (awaitingSearchQuery && /^(?:cancel|never\s+mind|nevermind)\b/i.test(text)) {
    awaitingSearchQuery = false;
    response = "Okay, search canceled.";
  } else if (awaitingSearchQuery) {
    const query = extractInlineSearchQuery(command) || command.trim();
    if (!query) {
      response = "Tell me what to search on Google.";
    } else {
      awaitingSearchQuery = false;
      showDesktopImage();
      setMood("serious");
      const desktop = await askDesktop(`search the web for ${query}`);
      if (desktop && desktop.ok) {
        response = desktop.message;
        lastDesktopMessage = response;
      } else {
        response = "Search failed. Ensure python server.py is running.";
      }
    }
  } else if (danceLocked && currentMotion === "dance" && isMovementOverrideCommand(text)) {
    danceLocked = false;
  } else if (danceLocked && currentMotion === "dance") {
    response = "I am still dancing. Say stop when you want me to stop.";
  } else if (nameMatch) {
    userName = nameMatch[1].trim().replace(/\s+/g, " ");
    localStorage.setItem("aivaUserName", userName);
    nameInput.value = userName;
    setMood("happy");
    setMotion("wave");
    response = `Nice to meet you, ${userName}. I will personalize my replies for you.`;
  } else if (text.includes("short skirt")) {
    changeOutfit();
    setMood("happy");
    setMotion("shortskirt");
    response = "I changed into the professional short skirt outfit.";
  } else if (text.includes("wear a skirt") || text.includes("skirt") || text.includes("beautiful legs")) {
    changeOutfit();
    setMood("happy");
    setMotion("outfit");
    response = "I changed into the professional skirt outfit.";
  } else if (text.includes("change your outfit") || text.includes("change outfit") || text.includes("new outfit") || text.includes("changing clothes") || /\boutfit\b/i.test(text)) {
    changeOutfit();
    setMood("happy");
    setMotion("outfit");
    response = "I changed into the professional skirt outfit.";
  } else if ((text.includes("read") && text.includes("email")) || text.includes("read my emails")) {
    showDesktopImage();
    setMood("serious");
    response = "Opening your Outlook email. I cannot read private emails until you connect an authorized mail account.";
    const desktop = await askDesktop("check my emails");
    if (desktop && desktop.ok) {
      lastDesktopMessage = desktop.message;
    } else {
      response = "Email failed. Ensure python server.py is running.";
    }
  } else if (text.includes("check my emails") || text.includes("check email") || text.includes("check emails") || isEmailShortcut(text)) {
    showDesktopImage();
    setMood("serious");
    response = "Opening your Outlook email.";
    const desktop = await askDesktop("check my emails");
    if (desktop && desktop.ok) {
      lastDesktopMessage = desktop.message;
    } else {
      response = "Email failed. Ensure python server.py is running.";
    }
  } else if (isSearchPromptOnly(text)) {
    awaitingSearchQuery = true;
    showDesktopImage();
    setMood("curious");
    response = "What should I search on Google?";
  } else if (isWebSearchCommand(text)) {
    const inlineQuery = extractInlineSearchQuery(command);
    if (!inlineQuery) {
      awaitingSearchQuery = true;
      showDesktopImage();
      setMood("curious");
      response = "What should I search on Google?";
    } else {
      awaitingSearchQuery = false;
      showDesktopImage();
      setMood("serious");
      const desktop = await askDesktop(`search the web for ${inlineQuery}`);
      if (desktop && desktop.ok) {
        response = desktop.message;
        lastDesktopMessage = response;
      } else {
        response = "Search failed. Ensure python server.py is running.";
      }
    }
  } else if (isDesktopCommand(text)) {
    showDesktopImage();
    setMood("serious");
    const desktop = await askDesktop(command);
    if (desktop) {
      response = desktop.message;
      lastDesktopMessage = response;
    } else {
      response = "Desktop control needs the local Python server. Run python server.py, then open the local page.";
    }
  } else if (text.includes("dance")) {
    danceLocked = true;
    setTurnAngle(0);
    setMotion("dance");
    setMood("happy");
    response = "Dancing routine activated. I am showing my full body.";
  } else if (/\bmove\b/i.test(text)) {
    setTurnAngle(0);
    setMotion("move");
    setMood("happy");
    response = "Move sequence activated.";
  } else if (text.includes("walk") || text.includes("walking")) {
    setTurnAngle(0);
    setMotion("walk");
    setMood("happy");
    response = "Walking video activated.";
  } else if (/\b(sit|seat|sitting)\b/i.test(text)) {
    setTurnAngle(0);
    setMotion("sit");
    setMood("calm");
    response = "Sitting posture activated.";
  } else if (/^(?:360|3\s*60|three\s+sixty)\b/.test(text)
    || text.includes("rotate 360")
    || text.includes("turn 360")
    || text.includes("spin")
    || text.includes("turn around completely")) {
    setTurnAngle(0);
    setMotion("turn360");
    setMood("curious");
    response = "Showing a 3-image animated 360 turn sequence.";
  } else if (text.includes("face front") || text.includes("turn front")) {
    setTurnAngle(0);
    setMotion("dance");
    response = "Showing full body front view.";
  } else if (text.includes("face left") || text.includes("turn left")) {
    setTurnAngle(0);
    setMotion("dance");
    response = "Side-angle rotation needs a rigged 3D model. Showing full body front view.";
  } else if (text.includes("face right") || text.includes("turn right")) {
    setTurnAngle(0);
    setMotion("dance");
    response = "Side-angle rotation needs a rigged 3D model. Showing full body front view.";
  } else if (text.includes("face back") || text.includes("turn back") || text.includes("turn around")) {
    setTurnAngle(0);
    setMotion("turn360");
    response = "Showing full body front and back views.";
  } else if (/\bturn\s+\d{1,3}/.test(text) || /\brotate\s+\d{1,3}/.test(text)) {
    const angleMatch = text.match(/\b(?:turn|rotate)\s+(\d{1,3})/);
    const angle = Math.min(360, Number(angleMatch[1]));
    setTurnAngle(0);
    setMotion(angle >= 135 ? "turn360" : "dance");
    response = angle >= 135 ? "Showing full body front and back views." : "Showing full body front view.";
  } else if (text.includes("wave")) {
    showDesktopImage();
    setMood("happy");
    response = "Waving now.";
  } else if (text.includes("scan") || text.includes("look around")) {
    showDesktopImage();
    setMood("curious");
    response = "Scanning the room.";
  } else if (text.includes("guard") || text.includes("protect")) {
    showDesktopImage();
    setMood("serious");
    response = "Guard mode enabled. I am watching.";
  } else if (text.includes("sleep") || text.includes("power down")) {
    setMotion("sleep");
    setMood("calm");
    modeBadge.textContent = "RESTING";
    response = "Entering quiet sleep mode.";
  } else if (text.includes("wake") || text.includes("online")) {
    setTurnAngle(0);
    setMotion("idle");
    setMood("calm");
    modeBadge.textContent = "ONLINE";
    response = "I am awake and ready.";
  } else if (text.includes("stop") || text.includes("stand still") || text.includes("idle")) {
    setMotion("idle");
    response = "Stopping movement.";
  } else if (text.includes("happy") || text.includes("smile")) {
    showDesktopImage();
    setMood("happy");
    response = "Happy mode selected.";
  } else if (text.includes("serious") || text.includes("focus")) {
    showDesktopImage();
    setMood("serious");
    response = "Focused and serious.";
  } else if (text.includes("curious")) {
    showDesktopImage();
    setMood("curious");
    response = "Curiosity protocol is active.";
  } else if (text.includes("calm")) {
    showDesktopImage();
    setMood("calm");
    response = "Calm mode restored.";
  } else if (text.includes("introduce") || text.includes("who are you")) {
    showDesktopImage();
    setMood("happy");
    response = "I am Lee, your animated AI robot companion. I obey your commands.";
  } else if (text.includes("glow") || text.includes("color")) {
    showDesktopImage();
    const foundColor = Object.keys(colors).find((name) => text.includes(name));
    setAccent(foundColor || "blue");
    response = `Glow color set to ${foundColor || "blue"}.`;
  } else if (isPotentialDesktopAppCommand(text)) {
    showDesktopImage();
    setMood("serious");
    const desktop = await askDesktop(command);
    if (desktop && desktop.ok) {
      response = desktop.message;
      lastDesktopMessage = response;
    } else {
      response = "I could not open or close that application on this machine.";
    }
  } else {
    setMood("curious");
    response = "I heard you. Teach me that command by adding it to my command brain.";
  }

  if (lastDesktopMessage && response !== lastDesktopMessage && text.includes("status")) {
    response = lastDesktopMessage;
  }

  speak(personalize(response));
  remember(command, response);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  unlockSpeechSynthesis();
  tryResumeDanceMusicOnGesture();
  obey(stripOptionalWakePhrase(input.value));
  input.value = "";
  input.focus();
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    unlockSpeechSynthesis();
    tryResumeDanceMusicOnGesture();

    if (button.dataset.command === "search") {
      const query = promptSearchQuery();
      if (!query) {
        reply.textContent = "Search canceled.";
        return;
      }
      obey(`search the web for ${query}`);
      return;
    }

    obey(button.dataset.command);
  });
});

stopBtn.addEventListener("click", () => {
  unlockSpeechSynthesis();
  tryResumeDanceMusicOnGesture();
  stopAiva(true);
  remember("Stop button", "Stopped.");
});

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  unlockSpeechSynthesis();
  tryResumeDanceMusicOnGesture();
  userName = nameInput.value.trim().replace(/\s+/g, " ");
  if (!userName) {
    speak("Please enter your name so I can personalize the interaction.");
    nameInput.focus();
    return;
  }
  localStorage.setItem("aivaUserName", userName);
  setMood("happy");
  setMotion("wave");
  speak(welcomeMessage(userName));
  input.focus();
});

if (SpeechRecognition) {
  recognizer = new SpeechRecognition();
  recognizer.lang = "en-US";
  recognizer.interimResults = false;
  recognizer.continuous = true;

  async function requestMicrophonePermission() {
    if (!window.isSecureContext) {
      autoListen = false;
      micStartedByUser = false;
      listenBtn.textContent = "Start Mic";
      modeBadge.textContent = "MIC BLOCKED";
      reply.textContent = "Microphone needs a secure context. Open Lee from http://127.0.0.1:5180 or https.";
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      autoListen = false;
      micStartedByUser = false;
      listenBtn.textContent = "Mic blocked";
      modeBadge.textContent = "MIC BLOCKED";
      reply.textContent = "Microphone permission is blocked. Allow microphone access in Chrome, then click Start Mic again.";
      console.warn("AIVA microphone permission failed:", error);
      return false;
    }
  }

  function startListening() {
    if (!autoListen || isRecognizing) {
      return;
    }

    if ("speechSynthesis" in window && window.speechSynthesis.speaking) {
      window.setTimeout(startListening, 300);
      return;
    }

    try {
      pauseListeningForSpeech = false;
      setListening(true);
      recognizer.start();
    } catch (error) {
      isRecognizing = false;
      setListening(false);
      listenBtn.textContent = autoListen ? "Starting..." : "Start Mic";
      modeBadge.textContent = autoListen ? "MIC STARTING" : "MIC READY";
      reply.textContent = autoListen
        ? "Retrying microphone... Say dance."
        : "Click Start Mic, then say your command.";
      if (autoListen) {
        window.setTimeout(startListening, 900);
      }
      console.warn("AIVA mic start failed:", error);
    }
  }

  restartListeningSoon = () => {
    if (autoListen) {
      window.setTimeout(startListening, 250);
    }
  };

  recognizer.addEventListener("start", () => {
    isRecognizing = true;
    setListening(true);
    listenBtn.textContent = "Listening";
    reply.textContent = "I am listening. Say your command.";
  });

  recognizer.addEventListener("result", (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (!event.results[index].isFinal) {
        continue;
      }

      const transcript = event.results[index][0].transcript.trim();
      const command = (stripOptionalWakePhrase(transcript) || transcript).trim();
      const normalizedTranscript = transcript.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
      const now = Date.now();
      input.value = transcript;
      if (!command) {
        reply.textContent = "I heard audio, but not a clear command. Try again.";
        continue;
      }

      if (isStopCommand(command) || isStopCommand(transcript) || /^(?:top|stap)$/.test(normalizedTranscript)) {
        lastHeardAt = now;
        lastHeardCommand = "stop";
        input.value = "stop";
        reply.textContent = "Heard command: stop";
        obey("stop");
        break;
      }

      if (command === lastHeardCommand && now - lastHeardAt < 1800) {
        continue;
      }

      lastHeardAt = now;
      lastHeardCommand = command;
      input.value = command;
      reply.textContent = `Heard command: ${command}`;
      obey(command);
      break;
    }
  });

  recognizer.addEventListener("error", (event) => {
    isRecognizing = false;
    setListening(false);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      autoListen = false;
      micStartedByUser = false;
      listenBtn.textContent = "Mic blocked";
      modeBadge.textContent = "MIC BLOCKED";
      reply.textContent = "Microphone is blocked. Allow microphone permission in the browser, then click Start Mic.";
    } else if (event.error === "no-speech") {
      reply.textContent = "I did not hear speech. Say your command again.";
    } else if (event.error === "audio-capture") {
      autoListen = false;
      micStartedByUser = false;
      listenBtn.textContent = "No mic";
      modeBadge.textContent = "NO MIC";
      reply.textContent = "No microphone was detected. Check your Windows input device.";
    } else {
      reply.textContent = `Microphone error: ${event.error}. Click Start Mic to try again.`;
    }
  });

  recognizer.addEventListener("end", () => {
    isRecognizing = false;
    setListening(false);
    listenBtn.textContent = autoListen ? "Listening" : "Start Mic";
    if (pauseListeningForSpeech) {
      modeBadge.textContent = "AIVA SPEAKING";
      return;
    }
    if (currentMotion !== "sleep") {
      modeBadge.textContent = autoListen ? "LISTENING" : "ONLINE";
    }
    if (autoListen) {
      window.setTimeout(startListening, 450);
    }
  });

  listenBtn.addEventListener("click", async () => {
    unlockSpeechSynthesis();
    if (!autoListen) {
      autoListen = true;
      micStartedByUser = true;
      listenBtn.textContent = "Starting...";
      modeBadge.textContent = "MIC STARTING";
      const allowed = await requestMicrophonePermission();
      if (!allowed) {
        autoListen = false;
        micStartedByUser = false;
        listenBtn.textContent = "Start Mic";
        return;
      }
      startListening();
    } else if (isRecognizing) {
      autoListen = false;
      micStartedByUser = false;
      listenBtn.textContent = "Start Mic";
      recognizer.stop();
    } else {
      autoListen = false;
      micStartedByUser = false;
      listenBtn.textContent = "Start Mic";
      modeBadge.textContent = "ONLINE";
    }
  });

  listenBtn.textContent = "Start Mic";
  modeBadge.textContent = "ONLINE";
  reply.textContent = "Click Start Mic, then say your command.";
} else {
  listenBtn.disabled = true;
  listenBtn.title = "Voice recognition is not available in this browser";
}

if ("speechSynthesis" in window) {
  chooseFemaleVoice();
  window.speechSynthesis.addEventListener("voiceschanged", chooseFemaleVoice);
  document.addEventListener("pointerdown", unlockSpeechSynthesis, { once: true });
  document.addEventListener("keydown", unlockSpeechSynthesis, { once: true });
}

setAccent("blue");
setMood("calm");
setMotion("idle");
setPortraitMode("static");
showStaticFace(chooseRandomFaceFrame());

const startupName = userName || "user";

if (userName) {
  nameInput.value = userName;
  reply.textContent = welcomeMessage(userName);
} else {
  reply.textContent = `${welcomeMessage("user")} Say 'Hey Lee dance' or type your command.`;
  nameInput.focus();
}

if ("speechSynthesis" in window) {
  window.setTimeout(() => {
    speak(welcomeMessage(startupName));
  }, 700);
}
