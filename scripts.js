const baseApiUrl = 'https://api.coingecko.com/api/v3/simple/price';
const coinDetailsUrl = 'https://api.coingecko.com/api/v3/coins/';
const apiKeys = ['CG-gjMFaaWvegooR4G5JtgXm6tt', 'CG-acHzUtSKiG7z37pdrTadUxJc', 'CG-5LeQPVdQKzrN7LPxGMB5fKbn'];
let currentApiKeyIndex = 0;

let users = JSON.parse(getStorageItem('users')) || {};
let loggedInUser = getStorageItem('loggedInUser') || null;

let apiUrl = '';
let previousTotalHoldings = 0;
let totalHoldings24hAgo = null;
let recordHigh = 0;
let recordLow = Infinity;

let socket;
let lastWebSocketUpdate = Date.now();
const twoMinutes = 2 * 60 * 1000;

let candlestickChart;
let currentCryptoId;

function getApiKey() {
    return apiKeys[currentApiKeyIndex];
}

function switchApiKey() {
    currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
    console.log(`Switched to API key: ${getApiKey()}`);
}

async function fetchWithFallback(url) {
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = getApiKey();
        const urlWithApiKey = url.replace(/x_cg_demo_api_key=[^&]*/, `x_cg_demo_api_key=${apiKey}`);
        try {
            const response = await fetch(urlWithApiKey);
            if (!response.ok) {
                throw new Error('Failed to fetch data');
            }
            console.log(`Successfully fetched data with API key: ${apiKey}`);
            return await response.json();
        } catch (error) {
            console.error(`Error with API key ${apiKey}:`, error);
            switchApiKey();
        }
    }
    throw new Error('All API keys failed');
}

async function fetchWithApiKeyRotation(url) {
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = getApiKey();
        const urlWithApiKey = url.replace(/x_cg_demo_api_key=[^&]*/, `x_cg_demo_api_key=${apiKey}`);
        try {
            const response = await fetch(urlWithApiKey);

            if (response.status === 429) {
                // Rate limit hit, switch API key and retry
                console.warn(`Rate limit hit with API key: ${apiKey}. Switching to next key.`);
                switchApiKey();
                continue; // Try the next key
            }

            if (!response.ok) {
                // Handle other HTTP errors
                throw new Error(`Failed to fetch data: ${response.status}`);
            }

            console.log(`Successfully fetched data with API key: ${apiKey}`);
            return await response.json(); // Return the fetched data if successful

        } catch (error) {
            console.error(`Error fetching data with API key ${apiKey}:`, error);
            switchApiKey(); // Switch to the next API key on error
        }
    }

    // If all API keys fail, throw an error
    throw new Error('All API keys failed');
}


function initializeApp() {
    const notificationPermission = getStorageItem('notificationPermission');
    if (notificationPermission !== 'granted') {
        requestNotificationPermission();
    }

    checkAndRequestNotificationPermission();

    const message = getStorageItem('modalMessage');
    if (message) {
        showModal(message);
        removeStorageItem('modalMessage');
    }

    const tradeMessage = getStorageItem('tradeModalMessage');
    if (tradeMessage) {
        showTradeModal(tradeMessage);
        removeStorageItem('tradeModalMessage');
    }

    if (loggedInUser) {
        showAppPage();
        clearCryptoContainers();
        loadUserData();

        updateApiUrl();

        setWebSocketCycle();
        fetchPrices();

        // Initialize the audio toggle
        const audioToggle = document.getElementById('audio-toggle');
        audioToggle.checked = false;
        audioToggle.addEventListener('change', function () {
            const goodSound = document.getElementById('good-sound');
            const badSound = document.getElementById('bad-sound');
            const levelUpSound = document.getElementById('level-up-sound');
            const warningSound = document.getElementById('warning-sound');
            const milestoneSound = document.getElementById('milestone-sound');
            const recordHighSound = document.getElementById('record-high-sound'); 

            if (this.checked) {
                goodSound.muted = false;
                badSound.muted = false;
                levelUpSound.muted = false;
                warningSound.muted = false;
                milestoneSound.muted = false;
                recordHighSound.muted = false; 
            } else {
                goodSound.muted = true;
                badSound.muted = true;
                levelUpSound.muted = true;
                warningSound.muted = true;
                milestoneSound.muted = true;
                recordHighSound.muted = true; 
            }
        });

        // Initialize the dark mode toggle
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        darkModeToggle.addEventListener('change', function () {
            const logo = document.querySelector('.app-logo');
            if (this.checked) {
                document.body.classList.add('dark-mode');
                document.body.classList.remove('light-mode');
                logo.src = 'ausolpay-logo.png'; 
            } else {
                document.body.classList.add('light-mode');
                document.body.classList.remove('dark-mode');
                logo.src = 'ausolpay-logo-light.png'; 
            }
        });

        // Initialize record high and low display
        recordHigh = parseFloat(getStorageItem(`${loggedInUser}_recordHigh`)) || 0;
        recordLow = parseFloat(getStorageItem(`${loggedInUser}_recordLow`)) || Infinity;
        updateRecordDisplay();

        // Initialize milestone display
        const lastMilestone = parseInt(getStorageItem(`${loggedInUser}_lastMilestone`)) || 0;
        const milestoneElement = document.getElementById('daily-milestone');
        if (milestoneElement) {
            milestoneElement.textContent = `$${formatNumber(lastMilestone.toFixed(2))}`;
        } else {
            console.error("Milestone element not found during initialization.");
        }

        // Fetch initial 7-day percentage changes and apply border colors if needed
        users[loggedInUser].cryptos.forEach(crypto => {
            fetchInitialPercentageChanges(crypto.id);
        });

        totalHoldings24hAgo = parseFloat(getStorageItem(`${loggedInUser}_totalHoldings24hAgo`)) || null;

        updateTotalHoldings();
        updatePercentageChange(previousTotalHoldings);

        // Add event listeners for Enter key to update holdings
        document.querySelectorAll('[id$="-input"]').forEach(input => {
            input.addEventListener('keyup', function(event) {
                if (event.key === 'Enter') {
                    const cryptoId = this.id.replace('-input', '');
                    updateHoldings(cryptoId);
                }
            });
        });
    } else {
        showLoginPage();
    }
}



function getNotificationPermission() {
    return localStorage.getItem('notificationPermission');
}

// Function to check and request notification permission
function checkAndRequestNotificationPermission() {
    const notificationPermission = localStorage.getItem('notificationPermission');

    if (!notificationPermission) {
        requestNotificationPermission();
    } else if (notificationPermission === 'granted') {
        console.log('Notification permission already granted.');
    } else {
        console.log('Notification permission previously denied.');
    }
}

// Function to request notification permission and store it
function requestNotificationPermission() {
    Notification.requestPermission().then(permission => {
        localStorage.setItem('notificationPermission', permission);
        if (permission === 'granted') {
            console.log('Notification permission granted.');
        } else {
            console.log('Notification permission denied.');
        }
    });
}


function setWebSocketCycle() {
    let isWebSocketOpen = false;

    const openWebSocket = () => {
        if (!isWebSocketOpen) {
            initializeWebSocket();  // MEXC WebSocket
            initializeLBankWebSocket();  // LBank WebSocket
            isWebSocketOpen = true;
        }
    };

    const closeWebSocket = () => {
        if (isWebSocketOpen) {
            if (socket) {
                socket.close();
            }
            if (lbankSocket) {
                lbankSocket.close();
            }
            isWebSocketOpen = false;
        }
    };

    openWebSocket();

    setInterval(() => {
        closeWebSocket();
        setTimeout(openWebSocket, 5000);
    }, 600000); // Reconnect every 10 minutes
}


function closeWebSocket() {
    if (socket) {
        socket.close();
    }
}

function clearCryptoContainers() {
    const cryptoContainers = document.getElementById('crypto-containers');
    while (cryptoContainers.firstChild) {
        cryptoContainers.removeChild(cryptoContainers.firstChild);
    }
}

function loadUserData() {
    const activeElement = document.activeElement;
    const activeElementId = activeElement ? activeElement.id : null;
    const activeSelectionStart = activeElement ? activeElement.selectionStart : null;
    const activeSelectionEnd = activeElement ? activeElement.selectionEnd : null;

    if (users[loggedInUser]) {
        if (!users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos = [];
        }

        users[loggedInUser].cryptos.forEach(crypto => {
            const container = document.getElementById(`${crypto.id}-container`);
            if (!container) {
                addCryptoContainer(crypto.id, crypto.symbol, crypto.name, crypto.thumb);
            }

            const holdingsElement = document.getElementById(`${crypto.id}-holdings`);
            if (holdingsElement) {
                holdingsElement.textContent = formatNumber(
                    (parseFloat(localStorage.getItem(`${loggedInUser}_${crypto.id}Holdings`)) || 0).toFixed(3)
                );
            }
        });
    }

    // Restore focus and cursor position
    if (activeElementId) {
        const newActiveElement = document.getElementById(activeElementId);
        if (newActiveElement && newActiveElement.setSelectionRange) {
            newActiveElement.focus();
            newActiveElement.setSelectionRange(activeSelectionStart, activeSelectionEnd);
        }
    }
}




function showLoginPage() {
    document.getElementById('login-page').style.display = 'block';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
}

function showRegisterPage() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'block';
    document.getElementById('app-page').style.display = 'none';
}

function showAppPage() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'block';
}

function login() {
    const email = document.getElementById('email-login').value;
    const password = document.getElementById('password-login').value;

    if (users[email] && users[email].password === password) {
        loggedInUser = email;
        setStorageItem('loggedInUser', loggedInUser);
        setStorageItem('modalMessage', 'Successfully logged in!');
        showAppPage();
        updateAppContent(); // New function call
    } else {
        showModal('Invalid email or password. Please try again.');
    }
}


function register() {
    const firstName = document.getElementById('first-name').value.trim();
    const lastName = document.getElementById('last-name').value.trim();
    const email = document.getElementById('email-register').value.trim();
    const phone = formatPhoneNumber(document.getElementById('phone').value.trim());
    const password = document.getElementById('password-register').value.trim();
    const confirmPassword = document.getElementById('confirm-password').value.trim();
    const termsAccepted = document.getElementById('terms-conditions').checked;

    if (!firstName || !lastName || !email || !phone || !password || !confirmPassword || !termsAccepted) {
        showModal('Please fill out all fields and accept the terms and conditions.');
        return;
    }
    const phonePattern = /^\d{4}\s\d{3}\s\d{3}$/;
    if (!phonePattern.test(phone)) {
        showModal('Please enter a valid phone number in the format 0400 000 000.');
        return;
    }

    if (password !== confirmPassword) {
        showModal('Passwords do not match. Please try again.');
        return;
    }

    const passwordPattern = /^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{6,}$/;
    if (!passwordPattern.test(password)) {
        showModal('Password must be at least 6 characters long and contain at least one number and one special character.');
        return;
    }

    if (users[email]) {
        showModal('User already registered. Please log in.');
        showLoginPage();
        return;
    }

    users[email] = { firstName, lastName, email, phone, password, cryptos: [], percentageThresholds: {} };
    localStorage.setItem('users', JSON.stringify(users));

    showModal('User registered successfully. Please log in.');
    showLoginPage();
}

function formatPhoneNumber(phone) {
    return phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
}

function logout() {
    loggedInUser = null;
    removeStorageItem('loggedInUser');
    setStorageItem('modalMessage', 'Successfully logged out!');
    showLoginPage();
    updateAppContent(); // New function call
}


function showTermsConditions() {
    document.getElementById('terms-conditions-modal').style.display = 'block';
}

function closeTermsConditions() {
    document.getElementById('terms-conditions-modal').style.display = 'none';
}

function updateRecordDisplay() {
    const recordHighElement = document.getElementById('record-high');
    const recordLowElement = document.getElementById('record-low');

    recordHighElement.innerHTML = `<span class="triangle triangle-up"></span><span class="positive">$${formatNumber(recordHigh.toFixed(2))}</span>`;
    recordLowElement.innerHTML = `<span class="triangle triangle-down"></span><span class="negative">$${recordLow === Infinity ? '0.00' : formatNumber(recordLow.toFixed(2))}</span>`;
}

function updateApiUrl() {
    const ids = users[loggedInUser].cryptos.map(crypto => crypto.id);
    apiUrl = `${baseApiUrl}?ids=${ids.join(',')}&vs_currencies=aud&x_cg_demo_api_key=${getApiKey()}`;
    console.log('API URL updated:', apiUrl);
}

function updateHoldings(crypto) {
    const input = document.getElementById(`${crypto}-input`);
    const holdings = parseFloat(input.value);

    if (!isNaN(holdings)) {
        // Save the updated holdings in storage
        setStorageItem(`${loggedInUser}_${crypto}Holdings`, holdings);

        // Update the displayed holdings in the UI
        document.getElementById(`${crypto}-holdings`).textContent = formatNumber(holdings.toFixed(3));

        // Get the current price in AUD
        const priceElement = document.getElementById(`${crypto}-price-aud`);
        const priceInAud = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;

        // Update the value in AUD
        document.getElementById(`${crypto}-value-aud`).textContent = formatNumber((holdings * priceInAud).toFixed(2));

        // Update the total holdings and re-sort containers by value
        updateTotalHoldings();
        sortContainersByValue();

        // Clear the input value and remove focus
        input.value = '';
        input.blur();
    }
}



let lbankSocket;
let isLbankWebSocketOpen = false;
let lastWebSocketUpdateForCrypto = {}; // To track WebSocket updates for each coin

function initializeLBankWebSocket() {
    const wsEndpoint = 'wss://www.lbkex.net/ws/V2/';
    lbankSocket = new WebSocket(wsEndpoint);

    lbankSocket.onopen = function() {
        console.log('LBank WebSocket connection opened');
        isLbankWebSocketOpen = true;

        // Subscribe to each crypto you need live prices for
        if (users[loggedInUser] && users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos.forEach(crypto => {
                const subscriptionMessage = JSON.stringify({
                    "action": "subscribe",
                    "subscribe": "tick",
                    "pair": `${crypto.symbol.toLowerCase()}_usdt` // Subscribe to the correct pair
                });

                lbankSocket.send(subscriptionMessage);
            });
        }
    };

// Parse and extract live price updates
lbankSocket.onmessage = function(event) {
    const message = JSON.parse(event.data);
    if (message && message.tick && message.tick.latest) {
        const price = parseFloat(message.tick.latest);  // Extract the live price
        const symbol = message.pair.split('_')[0].toLowerCase(); // Extract the symbol (lowercase for consistency)
        console.log(`Live price for ${symbol}: ${price} USDT`);

        lastWebSocketUpdateForCrypto[symbol] = Date.now(); // Track the last WebSocket update

        updatePriceFromWebSocket(symbol, price, 'LBank'); // Update UI with the live price
    }
};

    // Handle connection close
    lbankSocket.onclose = function() {
        console.log('LBank WebSocket connection closed');
        isLbankWebSocketOpen = false;
        reconnectLBankWebSocket(); // Ensure reconnection
    };

    lbankSocket.onerror = function(error) {
        console.error('LBank WebSocket error:', error);
        isLbankWebSocketOpen = false;
        reconnectLBankWebSocket();
    };
}

// Ensure reconnection if the WebSocket closes
function reconnectLBankWebSocket() {
    if (!isLbankWebSocketOpen) {
        console.log('Reconnecting LBank WebSocket...');
        setTimeout(() => {
            initializeLBankWebSocket();
        }, 5000); // Attempt to reconnect after 5 seconds
    }
}



function monitorLBankWebSocket() {
    if (!isLbankWebSocketOpen) {
        console.log('LBank WebSocket not open, reconnecting...');
        initializeLBankWebSocket();
    }
}

// Check WebSocket every 60 seconds
setInterval(monitorLBankWebSocket, 60000); 


async function fetchPricesFromCoinGecko(cryptoId) {
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=aud&x_cg_demo_api_key=${getApiKey()}`;

    try {
        const data = await fetchWithApiKeyRotation(apiUrl);
        if (data[cryptoId]) {
            return parseFloat(data[cryptoId].aud);
        } else {
            throw new Error(`No data found for ${cryptoId} in CoinGecko response`);
        }
    } catch (error) {
        console.error(`Error fetching price from CoinGecko: ${error.message}`);
        return null;
    }
}




async function fetchPricesFromUniswap(symbol) {
    const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
    const uniswapUrl = `${proxyUrl}https://api.uniswap.org/v1/price/${symbol.toUpperCase()}USDT`;

    try {
        const response = await fetch(uniswapUrl, { mode: 'cors' });
        if (!response.ok) {
            throw new Error(`Failed to fetch Uniswap price for ${symbol}`);
        }
        const data = await response.json();
        const priceInUsd = parseFloat(data.price);
        if (!priceInUsd || isNaN(priceInUsd)) {
            throw new Error(`Invalid price data from Uniswap for ${symbol}`);
        }
        console.log(`Uniswap price for ${symbol}: $${priceInUsd} USD`);
        return priceInUsd;
    } catch (error) {
        console.error(`Error fetching Uniswap price for ${symbol}:`, error);
        return null;
    }
}




function setWebSocketCycle() {
    let isWebSocketOpen = false;

    const openWebSocket = () => {
        if (!isWebSocketOpen) {
            initializeWebSocket();  // MEXC WebSocket
            initializeLBankWebSocket();  // LBank WebSocket
            isWebSocketOpen = true;
        }
    };

    const closeWebSocket = () => {
        if (isWebSocketOpen) {
            if (socket) {
                socket.close();
            }
            if (lbankSocket) {
                lbankSocket.close();
            }
            isWebSocketOpen = false;
        }
    };

    openWebSocket();

    setInterval(() => {
        closeWebSocket();
        setTimeout(openWebSocket, 5000);
    }, 600000); // Reconnect every 10 minutes
}


async function fetchPrices() {
    if (!apiUrl.includes('?ids=')) {
        console.log("No cryptocurrencies to fetch prices for.");
        return;
    }

    console.log('Fetching prices from CoinGecko...');
    try {
        const data = await fetchWithFallback(apiUrl); // Primary fetch from CoinGecko
        console.log('Prices fetched:', data);

        let pricesChanged = false;

        for (let crypto of users[loggedInUser].cryptos) {
            let priceAud = data[crypto.id]?.aud;

            // Try MEXC WebSocket if CoinGecko price is not available
            if (priceAud === undefined) {
                console.log(`Falling back to MEXC for ${crypto.symbol}...`);
                const mexcPriceUsd = await fetchMexcPrice(crypto.symbol);
                if (mexcPriceUsd) {
                    priceAud = mexcPriceUsd * conversionRate; // Conversion from USD to AUD
                    console.log(`MEXC price for ${crypto.symbol}: ${priceAud} AUD`);
                }
            }

            // Try Uniswap as the last backup if CoinGecko and MEXC fail
            if (priceAud === undefined) {
                console.log(`Falling back to Uniswap for ${crypto.symbol}...`);
                const uniswapPriceUsd = await fetchPricesFromUniswap(crypto.symbol);
                if (uniswapPriceUsd) {
                    priceAud = uniswapPriceUsd * conversionRate; // Conversion from USD to AUD
                    console.log(`Uniswap price for ${crypto.symbol}: ${priceAud} AUD`);
                }
            }

            // If we still don't have a price, log an error and skip updating this crypto
            if (priceAud === undefined) {
                console.error(`Failed to fetch price for ${crypto.symbol}`);
                continue;
            }

            // Update the DOM and app state with the fetched price
            const previousPriceAud = parseFloat(document.getElementById(`${crypto.id}-price-aud`).textContent.replace(/,/g, '').replace('$', '')) || 0;
            const priceElement = document.getElementById(`${crypto.id}-price-aud`);
            const triangleElement = document.getElementById(`${crypto.id}-triangle`);

            if (priceAud !== previousPriceAud) {
                pricesChanged = true;

                if (priceAud > previousPriceAud) {
                    priceElement.classList.remove('price-down', 'flash-red');
                    priceElement.classList.add('price-up');
                    flashColor(`${crypto.id}-price-aud`, 'flash-green');
                    triangleElement.classList.remove('triangle-down');
                    triangleElement.classList.add('triangle-up');
                } else if (priceAud < previousPriceAud) {
                    priceElement.classList.remove('price-up', 'flash-green');
                    priceElement.classList.add('price-down');
                    flashColor(`${crypto.id}-price-aud`, 'flash-red');
                    triangleElement.classList.remove('triangle-up');
                    triangleElement.classList.add('triangle-down');
                }

                priceElement.textContent = `$${formatNumber(priceAud.toFixed(8), true)}`;
                const holdings = parseFloat(getStorageItem(`${loggedInUser}_${crypto.id}Holdings`)) || 0;
                document.getElementById(`${crypto.id}-value-aud`).textContent = formatNumber((holdings * priceAud).toFixed(2));
            }
        }

        if (pricesChanged) {
            console.log('PRICES UPDATED');
            updateTotalHoldings();
            sortContainersByValue();
            users[loggedInUser].cryptos.forEach(crypto => {
                fetchPercentageChanges(crypto.id);
            });
        } else {
            console.log('NO PRICE UPDATES');
        }
    } catch (error) {
        console.error('All price fetching methods failed:', error);
    }
}


async function fetchPricesFromUniswap(symbol) {
    try {
        const uniswapUrl = `https://api.uniswap.org/v1/price/${symbol.toUpperCase()}USDT`; // Placeholder for the Uniswap API endpoint
        const response = await fetch(uniswapUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch Uniswap price for ${symbol}`);
        }
        const data = await response.json();
        const priceInUsd = parseFloat(data.price);
        if (!priceInUsd || isNaN(priceInUsd)) {
            throw new Error(`Invalid price data from Uniswap for ${symbol}`);
        }
        console.log(`Uniswap price for ${symbol}: $${priceInUsd} USD`);
        return priceInUsd;
    } catch (error) {
        console.error(`Error fetching Uniswap price for ${symbol}:`, error);
        return null;
    }
}


const vibrateToggle = document.getElementById('vibrate-toggle');
const vibrateLabel = document.getElementById('vibrate-label');
let isVibrateEnabled = getStorageItem('isVibrateEnabled') === 'true';

vibrateToggle.checked = isVibrateEnabled;
vibrateLabel.textContent = isVibrateEnabled ? 'Vibe: On' : 'Vibe: Off';

vibrateToggle.addEventListener('change', function () {
isVibrateEnabled = this.checked;
vibrateLabel.textContent = isVibrateEnabled ? 'Vibe: On' : 'Vibe: Off';
setStorageItem('isVibrateEnabled', isVibrateEnabled);
});

function updateTotalHoldings() {
    let totalHoldings = 0;

    users[loggedInUser].cryptos.forEach(crypto => {
        const priceAud = parseFloat(document.getElementById(`${crypto.id}-price-aud`).textContent.replace(/,/g, '').replace('$', '')) || 0;
        const holdings = parseFloat(getStorageItem(`${loggedInUser}_${crypto.id}Holdings`)) || 0;
        totalHoldings += holdings * priceAud;
    });

    if (totalHoldings !== previousTotalHoldings) {
        if (totalHoldings > previousTotalHoldings) {
            flashColor('total-holdings', 'flash-green');
            flashColor('modal-total-holdings', 'flash-green');
            playSound('good-sound');
            if (isVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate(100);
            }
        } else if (totalHoldings < previousTotalHoldings) {
            flashColor('total-holdings', 'flash-red');
            flashColor('modal-total-holdings', 'flash-red');
            playSound('bad-sound');
            if (isVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate(300);
            }
        }

        document.getElementById('total-holdings').textContent = `$${formatNumber(totalHoldings.toFixed(2))}`;

        if (totalHoldings > recordHigh) {
            recordHigh = totalHoldings;
            setStorageItem(`${loggedInUser}_recordHigh`, recordHigh);
            notifyRecordHigh();
            playRecordHighSound();
        }

        if (totalHoldings < recordLow && totalHoldings > 0) {
            recordLow = totalHoldings;
            setStorageItem(`${loggedInUser}_recordLow`, recordLow);
            notifyRecordLow();
        }

        updateRecordDisplay();

        document.title = `CryptFolio v1.5 | $${formatNumber(totalHoldings.toFixed(2))} AUD | Real-time Holdings Tracker`;

        updatePercentageChange(totalHoldings);
        previousTotalHoldings = totalHoldings;

        updateTotalHoldingsModal();

        updateMilestone(totalHoldings);

        resetMilestone();
    }
}

function flashColor(elementId, className) {
    const element = document.getElementById(elementId);
    element.classList.add(className);
    setTimeout(() => {
        element.classList.remove(className);
    }, 1000);
}

function playRecordHighSound() {
    const sound = document.getElementById('record-high-sound');
    if (sound && !sound.muted) {
        sound.play().catch(error => {
            console.error('Sound play failed:', error);
        });
    }
}

function playSound(soundId) {
    const sound = document.getElementById(soundId);
    if (sound && !sound.muted) {
        sound.play().catch(error => {
            console.error('Sound play failed:', error);
        });
    }
}

let lastNotificationTimestamp = 0; // Tracks the last notification timestamp
const notificationCooldown = 30000; // 30-second cooldown

function notifyRecordHigh() {
    const now = Date.now();
    if (now - lastNotificationTimestamp < notificationCooldown) {
        console.log('Record High notification suppressed due to cooldown.');
        return; // Exit if cooldown period hasn't passed
    }

    const icon = 'images/record-high-icon.png';
    checkAndRequestNotificationPermission();
    sendNotification(
        'New Record High!',
        `Your portfolio reached a new record high of $${formatNumber(recordHigh.toFixed(2))}`,
        icon
    );
    lastNotificationTimestamp = now; // Update the last notification timestamp
}

function notifyRecordLow() {
    const now = Date.now();
    if (now - lastNotificationTimestamp < notificationCooldown) {
        console.log('Record Low notification suppressed due to cooldown.');
        return; // Exit if cooldown period hasn't passed
    }

    const icon = 'images/record-low-icon.png';
    checkAndRequestNotificationPermission();
    sendNotification(
        'New Record Low',
        `Your portfolio hit a new record low of $${formatNumber(recordLow.toFixed(2))}`,
        icon
    );
    lastNotificationTimestamp = now; // Update the last notification timestamp
}

function notifyPortfolioChange(change) {
    const icon = change > 0 ? 'images/positive-icon.png' : 'path/to/negative-icon.png';
    const changeText = change > 0 ? 'increased' : 'decreased';
    checkAndRequestNotificationPermission();
    sendNotification(
        'Portfolio Update',
        `Your portfolio has ${changeText} by ${Math.abs(change).toFixed(2)}% in the last 24 hours.`,
        icon
    );
}

function notifyMilestone(milestone) {
    const icon = 'images/milestone-icon.png';
    checkAndRequestNotificationPermission();
    sendNotification(
        'Milestone Achieved!',
        `You've reached a new milestone of $${formatNumber(milestone.toFixed(2))}`,
        icon
    );
}


function notifyTradeModal(symbol, logo) {
    checkAndRequestNotificationPermission();
    sendNotification('Trade Alert', `It's a good time to trade ${symbol}`, logo);
}

function updateMilestone(totalHoldings) {
    const milestoneElement = document.getElementById('daily-milestone');
    if (!milestoneElement) {
        console.error("Milestone element not found.");
        return;
    }
    let lastMilestone = parseInt(localStorage.getItem(`${loggedInUser}_lastMilestone`)) || 0;

    if (totalHoldings >= lastMilestone + 1000) {
        lastMilestone = Math.floor(totalHoldings / 1000) * 1000;
        localStorage.setItem(`${loggedInUser}_lastMilestone`, lastMilestone);
        notifyMilestone(lastMilestone);
        playSound('milestone-sound');
        sortContainersByValue();
    }

    milestoneElement.textContent = `$${formatNumber(lastMilestone.toFixed(2))}`;
}

function confirmResetMilestone() {
    showModal('Are you sure you want to reset the milestone?', 'resetMilestone');
}

function resetMilestone() {
    const totalHoldings = parseFloat(document.getElementById('total-holdings').textContent.replace(/,/g, '').replace('$', '')) || 0;
    const lastMilestone = Math.floor(totalHoldings / 1000) * 1000;
    localStorage.setItem(`${loggedInUser}_lastMilestone`, lastMilestone);
    updateMilestone(totalHoldings);
}

function resetMilestoneEvery24Hours() {
    const lastReset = parseInt(getStorageItem(`${loggedInUser}_lastMilestoneReset`)) || Date.now();
    const now = Date.now();

    if (now - lastReset >= 86400000) {
        resetMilestone();
        setStorageItem(`${loggedInUser}_lastMilestoneReset`, now);
    }

    setTimeout(resetMilestoneEvery24Hours, 86400000 - (now - lastReset));
}

resetMilestoneEvery24Hours();

// Function to play sound and handle the Lottie animation
function playSound(soundId) {
    const sound = document.getElementById(soundId);
    if (sound) {
        if (!sound.muted) {
            sound.play().catch(error => {
                console.error('Sound play failed:', error);
            });
        }
        // If the milestone sound is played, show the Lottie animation and trigger vibrations
        if (soundId === 'milestone-sound') {
            playMilestoneAnimation();
            playMilestoneModalAnimation();
            if (isVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate([100, 100, 100, 100, 100, 100]); // 6 vibrations of 100ms each
            }
        }
    }
}


// Function to play the Lottie animation
function playMilestoneAnimation() {
    const lottieContainer = document.getElementById('lottie-container');
    const lottiePlayer = document.getElementById('milestone-animation');
    
    lottieContainer.style.display = 'block'; // Show the animation container

    // Play the animation
    lottiePlayer.play();

    // Hide the animation after it finishes (assuming the duration is known, here it's set to 3 seconds)
    setTimeout(() => {
        lottieContainer.style.display = 'none';
    }, 1100); // Adjust the timeout duration according to your animation length
}

// Function to play the Lottie animation in the modal
function playMilestoneModalAnimation() {
    const lottieContainer = document.getElementById('modal-lottie-container');
    const lottiePlayer = document.getElementById('modal-milestone-animation');
    
    lottieContainer.style.display = 'block'; // Show the animation container

    // Play the animation
    lottiePlayer.play();

    // Hide the animation after it finishes (assuming the duration is known, here it's set to 3 seconds)
    setTimeout(() => {
        lottieContainer.style.display = 'none';
    }, 1100); // Adjust the timeout duration according to your animation length
}

async function fetchInitialPercentageChanges(cryptoId) {
    const url = `${coinDetailsUrl}${cryptoId}?x_cg_demo_api_key=${getApiKey()}`;
    try {
        const data = await fetchWithFallback(url);
        const percentageChange7d = data.market_data.price_change_percentage_7d;

        if (!users[loggedInUser].percentageThresholds) {
            users[loggedInUser].percentageThresholds = {};
        }

        if (!users[loggedInUser].percentageThresholds[cryptoId]) {
            users[loggedInUser].percentageThresholds[cryptoId] = {
                levelUpThreshold: 20,
                warningThreshold: -20,
            };
        }

        const container = document.getElementById(`${cryptoId}-container`);

        if (percentageChange7d >= 20) {
            container.style.borderColor = '#00ff00';
        } else if (percentageChange7d <= -20) {
            container.style.borderColor = '#ff0000';
        } else {
            container.style.borderColor = ''; 
        }

        setStorageItem('users', JSON.stringify(users));
    } catch (error) {
        console.error('Error fetching initial percentage change data:', error);
    }
}

async function fetchPercentageChanges(cryptoId) {
    const url = `${coinDetailsUrl}${cryptoId}?x_cg_demo_api_key=${getApiKey()}`;
    try {
        const data = await fetchWithFallback(url);
        const percentageChange7d = data.market_data.price_change_percentage_7d;
        const percentageChange30d = data.market_data.price_change_percentage_30d;

        updatePercentageChangeUI(cryptoId, percentageChange7d, percentageChange30d);

           // Check for threshold cross and update storage if necessary
           const thresholdCrossed = checkThresholdCross(cryptoId, percentageChange7d);
           if (thresholdCrossed) {
               setStorageItem('users', JSON.stringify(users));
               updateAppContent(); // New function call
           }
       } catch (error) {
           console.error('Error fetching percentage change data:', error);
       }
}

function checkThresholdCross(cryptoId, percentageChange7d) {
       if (!users[loggedInUser].percentageThresholds) {
           users[loggedInUser].percentageThresholds = {};
       }

       if (!users[loggedInUser].percentageThresholds[cryptoId]) {
           users[loggedInUser].percentageThresholds[cryptoId] = {
               lastLevelUpThreshold: null,
               lastWarningThreshold: null,
           };
       }

       const { lastLevelUpThreshold, lastWarningThreshold } = users[loggedInUser].percentageThresholds[cryptoId];
       const container = document.getElementById(`${cryptoId}-container`);
       let thresholdCrossed = false;

       if (percentageChange7d >= 20 && (lastLevelUpThreshold === null || percentageChange7d >= lastLevelUpThreshold + 10)) {
           setStorageItem('tradeModalMessage', `Good time to sell your ${cryptoId}!`);
           playSound('level-up-sound');
           flashBorder(container, '#00ff00', '#00ff00');
           users[loggedInUser].percentageThresholds[cryptoId].lastLevelUpThreshold = Math.floor(percentageChange7d / 10) * 10;
           thresholdCrossed = true;
       }

       if (percentageChange7d <= -20 && (lastWarningThreshold === null || percentageChange7d <= lastWarningThreshold - 10)) {
           setStorageItem('tradeModalMessage', `Good time to buy more ${cryptoId}!`);
           playSound('warning-sound');
           flashBorder(container, '#ff0000', '#ff0000');
           users[loggedInUser].percentageThresholds[cryptoId].lastWarningThreshold = Math.floor(percentageChange7d / 10) * 10;
           thresholdCrossed = true;
       }

       return thresholdCrossed;
}

async function updateAppContent() {
    const activeElement = document.activeElement;
    const activeElementId = activeElement ? activeElement.id : null;

    clearCryptoContainers();
    loadUserData();

    updateApiUrl();

    setWebSocketCycle();
    await fetchPrices();

    updateTotalHoldings();
    updatePercentageChange(previousTotalHoldings);

    // Add event listeners for Enter key to update holdings
    document.querySelectorAll('[id$="-input"]').forEach(input => {
        input.addEventListener('keyup', function(event) {
            if (event.key === 'Enter') {
                const cryptoId = this.id.replace('-input', '');
                updateHoldings(cryptoId);
            }
        });
    });

    // Initialize record high and low display
    updateRecordDisplay();

    // Initialize milestone display
    const lastMilestone = parseInt(localStorage.getItem(`${loggedInUser}_lastMilestone`)) || 0;
    const milestoneElement = document.getElementById('daily-milestone');
    if (milestoneElement) {
        milestoneElement.textContent = `$${formatNumber(lastMilestone.toFixed(2))}`;
    } else {
        console.error("Milestone element not found during initialization.");
    }

    // Restore focus to the previously active input element
    if (activeElementId) {
        const newActiveElement = document.getElementById(activeElementId);
        if (newActiveElement) {
            newActiveElement.focus();
            // Restore cursor position if the focused element was a text input
            if (newActiveElement.setSelectionRange && activeElement.selectionStart !== undefined) {
                newActiveElement.setSelectionRange(
                    activeElement.selectionStart,
                    activeElement.selectionEnd
                );
            }
        }
    }
}


function updatePercentageChangeUI(cryptoId, percentageChange7d, percentageChange30d) {
    const percentageChangeElement7d = document.getElementById(`${cryptoId}-percentage-change-7d`);
    const triangleElement7d = document.getElementById(`${cryptoId}-triangle-7d`);
    const percentageChangeElement30d = document.getElementById(`${cryptoId}-percentage-change-30d`);
    const triangleElement30d = document.getElementById(`${cryptoId}-triangle-30d`);

    if (percentageChange7d > 0) {
        percentageChangeElement7d.classList.remove('negative');
        percentageChangeElement7d.classList.add('positive');
        triangleElement7d.classList.remove('triangle-down');
        triangleElement7d.classList.add('triangle-up');
    } else if (percentageChange7d < 0) {
        percentageChangeElement7d.classList.remove('positive');
        percentageChangeElement7d.classList.add('negative');
        triangleElement7d.classList.remove('triangle-up');
        triangleElement7d.classList.add('triangle-down');
    } else {
        percentageChangeElement7d.classList.remove('positive', 'negative');
        triangleElement7d.classList.remove('triangle-up', 'triangle-down');
    }

    percentageChangeElement7d.textContent = `${percentageChange7d.toFixed(2)}%`;
    percentageChangeElement7d.prepend(triangleElement7d);

    if (percentageChange30d > 0) {
        percentageChangeElement30d.classList.remove('negative');
        percentageChangeElement30d.classList.add('positive');
        triangleElement30d.classList.remove('triangle-down');
        triangleElement30d.classList.add('triangle-up');
    } else if (percentageChange30d < 0) {
        percentageChangeElement30d.classList.remove('positive');
        percentageChangeElement30d.classList.add('negative');
        triangleElement30d.classList.remove('triangle-up');
        triangleElement30d.classList.add('triangle-down');
    } else {
        percentageChangeElement30d.classList.remove('positive', 'negative');
        triangleElement30d.classList.remove('triangle-up', 'triangle-down');
    }

    percentageChangeElement30d.textContent = `${percentageChange30d.toFixed(2)}%`;
    percentageChangeElement30d.prepend(triangleElement30d);
}


function flashBorder(container, flashColor, finalColor) {
    let flashes = 0;
    const interval = setInterval(() => {
        container.style.borderColor = flashes % 2 === 0 ? flashColor : '';
        flashes++;
        if (flashes === 6) {
            clearInterval(interval);
            container.style.borderColor = finalColor; // Set the final color after flashing
        }
    }, 250);
}

function getCaretPosition(input) {
    return input.selectionStart;
}

function setCaretPosition(input, position) {
    input.setSelectionRange(position, position);
}

function getStorageItem(key) {
    let value = localStorage.getItem(key);
    if (value === null) {
        value = sessionStorage.getItem(key);
    }
    return value;
}

function setStorageItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('Local storage failed, using session storage', e);
        sessionStorage.setItem(key, value);
    }
}

function removeStorageItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
}


function updatePercentageChange(currentTotalHoldings) {
    const percentageChangeElement = document.getElementById('percentage-change');
    const triangleElement = percentageChangeElement.querySelector('.triangle');
    const valueChangeElement = document.getElementById('value-change');

    if (totalHoldings24hAgo === null) {
        totalHoldings24hAgo = currentTotalHoldings;
        setStorageItem(`${loggedInUser}_totalHoldings24hAgo`, totalHoldings24hAgo);
        setStorageItem(`${loggedInUser}_lastUpdated`, Date.now().toString());
    }

    const percentageChange = ((currentTotalHoldings - totalHoldings24hAgo) / totalHoldings24hAgo) * 100;
    const valueChange = currentTotalHoldings - totalHoldings24hAgo;

    percentageChangeElement.textContent = `${percentageChange.toFixed(2)}%`;
    valueChangeElement.textContent = `${valueChange >= 0 ? '(+$' + formatNumber(valueChange.toFixed(2)) + ')' : '(-$' + formatNumber(Math.abs(valueChange).toFixed(2)) + ')'}`;
    percentageChangeElement.prepend(triangleElement);

    if (percentageChange > 0) {
        percentageChangeElement.classList.remove('negative');
        percentageChangeElement.classList.add('positive');
        triangleElement.classList.remove('triangle-down');
        triangleElement.classList.add('triangle-up');
        valueChangeElement.classList.remove('negative');
        valueChangeElement.classList.add('positive');
    } else if (percentageChange < 0) {
        percentageChangeElement.classList.remove('positive');
        percentageChangeElement.classList.add('negative');
        triangleElement.classList.remove('triangle-up');
        triangleElement.classList.add('triangle-down');
        valueChangeElement.classList.remove('positive');
        valueChangeElement.classList.add('negative');
    } else {
        percentageChangeElement.classList.remove('positive', 'negative');
        triangleElement.classList.remove('triangle-up', 'triangle-down');
        valueChangeElement.classList.remove('positive', 'negative');
    }

    if (!getStorageItem(`${loggedInUser}_lastUpdated`) || Date.now() - parseInt(getStorageItem(`${loggedInUser}_lastUpdated`)) >= 86400000) {
        totalHoldings24hAgo = currentTotalHoldings;
        setStorageItem(`${loggedInUser}_totalHoldings24hAgo`, totalHoldings24hAgo);
        setStorageItem(`${loggedInUser}_lastUpdated`, Date.now().toString());
    }

    updateTotalHoldingsModal();
}


function updateTotalHoldingsModal() {
    const totalHoldings = document.getElementById('total-holdings').textContent;
    const percentageChange = document.getElementById('percentage-change').outerHTML;
    const valueChange = document.getElementById('value-change').outerHTML;
    const recordHigh = document.getElementById('record-high').outerHTML;
    const recordLow = document.getElementById('record-low').outerHTML;

    const formattedTotalHoldings = `${totalHoldings}`;

    const modalMessage = document.getElementById('total-holdings-content');
    modalMessage.innerHTML = `
        <div class="total-holdings-modal-content">
            <div class="modal-percentage-change">
                ${percentageChange} ${valueChange}
            </div>
            <div id="modal-total-holdings" class="modal-total-holdings">
               ${formattedTotalHoldings}
            </div>
            <div class="modal-records">
                ${recordHigh} &nbsp; | &nbsp; ${recordLow}
            </div>
        </div>
    `;
    flashColor('modal-total-holdings', 'flash-green');
}

document.querySelector('.ui-holdings').addEventListener('click', showTotalHoldingsModal);

function resetPercentage() {
    const currentTotalHoldings = parseFloat(document.getElementById('total-holdings').textContent.replace(/,/g, '').replace('$', '').replace('AUD', '').trim());
    totalHoldings24hAgo = currentTotalHoldings;
    localStorage.setItem(`${loggedInUser}_totalHoldings24hAgo`, totalHoldings24hAgo);
    localStorage.setItem(`${loggedInUser}_lastUpdated`, Date.now().toString());
    updatePercentageChange(currentTotalHoldings);
    showModal('Percentage reset successfully.');
}

function resetHighLow() {
    recordHigh = 0;
    recordLow = Infinity;
    localStorage.setItem(`${loggedInUser}_recordHigh`, recordHigh);
    localStorage.setItem(`${loggedInUser}_recordLow`, recordLow);
    updateRecordDisplay();
    showModal('High/Low records reset successfully.');
}

// Function to send notification
function sendNotification(title, body, icon) {
    const notificationPermission = localStorage.getItem('notificationPermission');
    if (notificationPermission === 'granted') {
        Push.create(title, {
            body: body,
            icon: icon,
            timeout: 5000,
            onClick: function () {
                window.focus();
                this.close();
            }
        });
    } else {
        console.log('Notification permission not granted.');
    }
}

function showModal(message, action = null, containerId = null, cryptoId = null) {
    const modal = document.getElementById('popup-modal');
    const modalMessage = document.getElementById('modal-message');
    modalMessage.innerHTML = message;
    if (action) {
        modalMessage.innerHTML += `
            <div style="display: flex; justify-content: center; margin-top: 20px; gap: 10px;">
                <button class="delete-button" onclick="confirmAction('${action}', '${containerId}', '${cryptoId}')">Confirm</button>
                <button class="cancel-button" onclick="closeModal()">Cancel</button>
            </div>
        `;
    }
    modal.style.display = 'block';
    modalMessage.classList.remove('total-holdings-modal-content');
}

function closeModal(delay = 0) {
    setTimeout(() => {
        document.getElementById('popup-modal').style.display = 'none';
        document.getElementById('total-holdings-modal').style.display = 'none';
    }, delay);
}

function showDeleteModal(containerId, cryptoId) {
    showModal('Are you sure you want to delete?', 'confirmDelete', containerId, cryptoId);
}

function confirmDelete(containerId, cryptoId) {
    deleteContainer(containerId, cryptoId);
    closeModal();
}

function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = 'block';
}

function confirmClearData() {
    showModal('Are you sure you want to clear all data?', 'clearData');
}

function confirmResetPercentage() {
    showModal('Are you sure you want to reset the percentage?', 'resetPercentage');
}

function confirmResetHighLow() {
    showModal('Are you sure you want to reset the high & low record?', 'resetHighLow');
}

function confirmLogout() {
    showModal('Are you sure you want to log out?', 'logout');
}

function confirmAction(action, containerId, cryptoId) {
    if (action === 'clearData') {
        clearData();
    } else if (action === 'resetPercentage') {
        resetPercentage();
    } else if (action === 'resetHighLow') {
        resetHighLow();
    } else if (action === 'resetMilestone') {
        resetMilestone();
    } else if (action === 'logout') {
        logout();
    } else if (action === 'confirmDelete') {
        confirmDelete(containerId, cryptoId);
    }
    closeModal();
}

function clearData() {
    const user = users[loggedInUser];
    user.cryptos.forEach(crypto => {
        localStorage.removeItem(`${loggedInUser}_${crypto.id}Holdings`);
    });

    user.cryptos = [];
    user.percentageThresholds = {};
    localStorage.setItem('users', JSON.stringify(users));

    document.getElementById('total-holdings').textContent = '0.00 AUD';
    document.getElementById('percentage-change').textContent = '0.00%';
    document.getElementById('value-change').textContent = '(+$0.00)';
    document.getElementById('record-high').innerHTML = `<span class="triangle triangle-up"></span><span class="positive">$0.00</span>`;
    document.getElementById('record-low').innerHTML = `<span class="triangle triangle-down"></span><span class="negative">$0.00</span>`;
    document.getElementById('percentage-change').className = 'neutral';
    document.getElementById('value-change').className = 'neutral';
    document.getElementById('daily-milestone').textContent = '$0.00';

    clearCryptoContainers();

    apiUrl = `${baseApiUrl}?vs_currencies=aud&x_cg_demo_api_key=${getApiKey()}`;

    recordHigh = 0;
    recordLow = Infinity;
    localStorage.setItem(`${loggedInUser}_recordHigh`, recordHigh);
    localStorage.setItem(`${loggedInUser}_recordLow`, recordLow);

    showModal('All data cleared successfully.');

    initializeApp();
}

function closeSettingsModal() {
    const settingsModal = document.getElementById('settings-modal');
    settingsModal.style.display = 'none';
}

document.querySelector('#settings-modal .close').addEventListener('click', closeSettingsModal);

window.onclick = function(event) {
    const popupModal = document.getElementById('popup-modal');
    const totalHoldingsModal = document.getElementById('total-holdings-modal');
    const settingsModal = document.getElementById('settings-modal');
    const candlestickModal = document.getElementById('candlestick-modal');
    if (event.target === popupModal || event.target === totalHoldingsModal || event.target === settingsModal || event.target === candlestickModal) {
        closeModal();
    }
};

async function addCrypto() {
    const cryptoId = document.getElementById('crypto-id-input').value.trim().toLowerCase();
    if (!cryptoId) return;

    try {
        const data = await fetchWithFallback(`${coinDetailsUrl}${cryptoId}?x_cg_demo_api_key=${getApiKey()}`);
        const { id, symbol, name, image: { thumb } } = data;

        const cryptoExists = users[loggedInUser].cryptos.some(crypto => crypto.id === id);
        if (cryptoExists) {
            showModal('Cryptocurrency already added.');
            return;
        }

        const newCrypto = { id, symbol, name, thumb };
        if (!users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos = [];
        }
        users[loggedInUser].cryptos.push(newCrypto);
        setStorageItem('users', JSON.stringify(users));

        addCryptoContainer(id, symbol, name, thumb);
        updateApiUrl();
        fetchPrices();
        document.getElementById('crypto-id-input').value = '';
        showModal('Crypto successfully added!');
        closeModal(1500);
    } catch (error) {
        showModal(error.message);
        console.error('Error adding new cryptocurrency:', error);
    }
}

function addCryptoContainer(id, symbol, name, thumb) {
    const newContainer = document.createElement('div');
    newContainer.classList.add('crypto-container');
    newContainer.id = `${id}-container`;

    newContainer.innerHTML = `
        <div class="logo-container" id="${id}-logo" onclick="openCandlestickModal('${id}')">
            <img src="${thumb}" alt="${name} Logo">
        </div>
        <h2>${name} (${symbol.toUpperCase()})</h2>
        <p><span id="${id}-triangle" class="triangle"></span><span id="${id}-price-aud">$0.00000000</span></p>
        <p><span id="${id}-holdings">0.000</span> ${symbol.toUpperCase()}</p>
        <p>$<span id="${id}-value-aud">0.00</span> AUD</p>
        <input type="number" id="${id}-input" style="margin-top: 15px;" placeholder="Enter ${name} holdings">
        <button style="margin-bottom: 15px;" onclick="updateHoldings('${id}')">Update Holdings</button>
        <button style="margin-bottom: 15px;" class="delete-button" onclick="showDeleteModal('${id}-container', '${id}')">Delete</button>
        <p>7D: <span id="${id}-triangle-7d" class="triangle"></span><span id="${id}-percentage-change-7d">0.00%</span> 30D: <span id="${id}-triangle-30d" class="triangle"></span><span id="${id}-percentage-change-30d">0.00%</span></p>
    `;

    document.getElementById('crypto-containers').appendChild(newContainer);

    const input = document.getElementById(`${id}-input`);
    input.addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            updateHoldings(id);
        }
    });

    fetchPrices();
}


function deleteContainer(containerId, cryptoId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.remove();
    }

    users[loggedInUser].cryptos = users[loggedInUser].cryptos.filter(crypto => crypto.id !== cryptoId);
    setStorageItem('users', JSON.stringify(users));

    removeStorageItem(`${loggedInUser}_${cryptoId}Holdings`);

    updateApiUrl();

    fetchPrices();
    updateTotalHoldings();
    sortContainersByValue();
}

function formatNumber(number, isPrice = false) {
    if (isPrice) {
        if (parseFloat(number) < 1) {
            return number.replace(/(\d{1,3})(?=\d{4})/g, '$1');
        } else {
            const parts = number.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            return parts.join('.');
        }
    }
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function sortContainersByValue() {
    const containers = Array.from(document.getElementsByClassName('crypto-container'));
    const containerParent = document.getElementById('crypto-containers');

    containers.sort((a, b) => {
        const aValue = parseFloat(a.querySelector('[id$="-value-aud"]').textContent.replace(/,/g, '').replace('$', '')) || 0;
        const bValue = parseFloat(b.querySelector('[id$="-value-aud"]').textContent.replace(/,/g, '').replace('$', '')) || 0;
        return bValue - aValue;
    });

    containers.forEach(container => containerParent.appendChild(container));
}

function updateCryptoValue(cryptoId) {
    const priceAud = parseFloat(document.getElementById(`${cryptoId}-price-aud`).textContent.replace(/,/g, '').replace('$', '')) || 0;
    const holdings = parseFloat(localStorage.getItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
    const currentValue = holdings * priceAud;
    document.getElementById(`${cryptoId}-value-aud`).textContent = formatNumber(currentValue.toFixed(2));
    updateTotalHoldings();
    sortContainersByValue();
}

function showTradeModal(message) {
    const modalMessage = document.getElementById('modal-message');
    modalMessage.innerHTML = `
        <span class="close" onclick="closeModal()">&times;</span>
        <div style="display: flex; flex-direction: column; align-items: center;">
            <p>${message}</p>
            <div style="display: flex; justify-content: center; margin-top: 20px;">
                <a href="https://www.coinbase.com" target="_blank" class="trade-button">Coinbase</a>
                <a href="https://www.mexc.com" target="_blank" class="trade-button">MEXC</a>
                <a href="https://www.binance.com" target="_blank" class="trade-button">Binance</a>
            </div>
        </div>
    `;
    document.getElementById('popup-modal').style.display = 'block';
}

function showTotalHoldingsModal() {
    const totalHoldings = document.getElementById('total-holdings').outerHTML;
    const percentageChange = document.getElementById('percentage-change').outerHTML;
    const valueChange = document.getElementById('value-change').outerHTML;
    const recordHigh = document.getElementById('record-high').outerHTML;
    const recordLow = document.getElementById('record-low').outerHTML;

    const modalMessage = document.getElementById('total-holdings-content');
    modalMessage.innerHTML = `
        <br><div class="total-holdings-modal-content">
            <div class="modal-percentage-change">
                ${percentageChange} ${valueChange}
            </div>
            <div class="modal-total-holdings">
                ${totalHoldings}
            </div>
            <div class="modal-records">
                ${recordHigh} &nbsp; | &nbsp; ${recordLow}
            </div>
        </div>
    `;
    updateTotalHoldingsModal(); // Ensure the modal content is updated before showing the modal
    document.getElementById('total-holdings-modal').style.display = 'block';
}

document.querySelector('.ui-holdings').addEventListener('click', showTotalHoldingsModal);

document.getElementById('password-login').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        login();
    }
});

document.getElementById('crypto-id-input').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        addCrypto();
    }
});

document.querySelectorAll('[id$="-input"]').forEach(input => {
    input.addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            const cryptoId = this.id.replace('-input', '');
            updateHoldings(cryptoId);
        }
    });
});

document.getElementById('confirm-password').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        register();
    }
});






function initializeWebSocket() {
    const wsEndpoint = 'wss://wbs.mexc.com/ws';
    socket = new WebSocket(wsEndpoint);
    lastWebSocketUpdate = Date.now();

    socket.onopen = function(event) {
        console.log('WebSocket connection opened');

        if (users[loggedInUser] && users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos.forEach(crypto => {
                const subscriptionMessage = JSON.stringify({
                    "method": "SUBSCRIPTION",
                    "params": [`spot@public.deals.v3.api@${crypto.symbol.toUpperCase()}USDT`],
                    "id": 1
                });
                
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(subscriptionMessage);
                } else {
                    socket.addEventListener('open', () => {
                        socket.send(subscriptionMessage);
                    });
                }
            });
        }
    };

    socket.onmessage = function(event) {
        try {
            const message = JSON.parse(event.data);

            if (message.msg === 'PONG') {
                return;
            }

            console.log('Message received:', message);

            if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
                const deals = message.d.deals;
                const firstDeal = deals[0];

                if (firstDeal && firstDeal.p !== undefined && message.s) {
                    const price = parseFloat(firstDeal.p);
                    const symbol = message.s.split('USDT')[0].toLowerCase();

                    console.log(`Extracted price for ${symbol}: ${price}`);

                    lastWebSocketUpdate = Date.now();

                    updatePriceFromWebSocket(symbol, price);
                } else {
                    console.log('Deal structure is not as expected:', firstDeal);
                }
            } else {
                console.log('Unexpected message format or empty data:', message);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };

    socket.onclose = function(event) {
        console.log('WebSocket connection closed');
    };

    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}

let lastPriceForCrypto = {}; // Store last price for each symbol
let lastWebSocketPriceUpdate = {}; 
let lastPriceUpdate = 0;  // Timestamp of the last update
const updateInterval = 1000;  // Minimum interval between updates (1 second)


let lastConversionRate = 1.52;  // Default fallback value
let lastRateTimestamp = 0;  // Timestamp of the last successful API call
const rateUpdateInterval = 15 * 60 * 1000;  // 15 minutes in milliseconds

// Function to get the USDT to AUD conversion rate with API rotation and caching
async function fetchUsdtToAudConversionRate() {
    const currentTime = Date.now();  // Get the current time

    // Check if 15 minutes have passed since the last API call
    if (currentTime - lastRateTimestamp < rateUpdateInterval) {
        console.log(`Using cached USDT to AUD conversion rate: ${lastConversionRate}`);
        return lastConversionRate;  // Return the cached rate
    }

    // If 15 minutes have passed, fetch a new rate
    let success = false;
    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        const apiKey = getApiKey();
        const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=aud&x_cg_demo_api_key=${apiKey}`;

        try {
            const response = await fetch(apiUrl);
            if (response.status === 429) {  // Too many requests, rotate API key
                console.warn(`API key ${apiKey} hit rate limit. Switching to the next key.`);
                switchApiKey();  // Rotate to the next key
                continue;  // Retry with the new key
            }
            if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

            const data = await response.json();
            lastConversionRate = data.tether.aud || 1.52;  // Update conversion rate or fallback to 1.52
            lastRateTimestamp = currentTime;  // Update the timestamp for the successful API call
            console.log(`New USDT to AUD Conversion Rate Retrieved: ${lastConversionRate}`);  // Log the new rate
            success = true;
            break;  // Exit the loop if successful
        } catch (error) {
            console.error(`Error with API key ${apiKey}:`, error);
            if (attempt === apiKeys.length - 1) {
                console.error('All API keys failed.');
            }
            switchApiKey();  // Rotate key if failed
        }
    }

    return lastConversionRate;  // Return the new or cached conversion rate
}

// Function to start the live check for the conversion rate every 15 minutes
function startConversionRateUpdate() {
    setInterval(async () => {
        const conversionRate = await fetchUsdtToAudConversionRate();
        console.log(`Updated USDT to AUD Conversion Rate: ${conversionRate}`);
    }, rateUpdateInterval);  // 15 minutes in milliseconds
}

// Start the live check for the conversion rate
startConversionRateUpdate();



let focusedElement = null;
let focusedElementSelectionStart = null;
let focusedElementSelectionEnd = null;

// Save focus details globally before DOM updates
function saveFocusDetails() {
    focusedElement = document.activeElement;
    if (focusedElement && focusedElement.tagName === 'INPUT') {
        focusedElementSelectionStart = focusedElement.selectionStart;
        focusedElementSelectionEnd = focusedElement.selectionEnd;
    } else {
        focusedElement = null;
    }
}

// Restore focus details after DOM updates
function restoreFocusDetails() {
    if (focusedElement && document.body.contains(focusedElement)) {
        focusedElement.focus();
        if (focusedElement.setSelectionRange && focusedElementSelectionStart !== null) {
            focusedElement.setSelectionRange(focusedElementSelectionStart, focusedElementSelectionEnd);
        }
    }
}

async function updatePriceFromWebSocket(symbol, priceInUsd, source = 'MEXC') {
    const conversionRate = await fetchUsdtToAudConversionRate(); // Fetch the real-time USD to AUD rate
    const priceInAud = priceInUsd * conversionRate; // Convert USD to AUD

    // Check if this is a new price
    if (lastPriceForCrypto[symbol] && lastPriceForCrypto[symbol] === priceInAud) {
        console.log(`Price for ${symbol} has not changed. No update needed.`);
        return; // Exit if the price hasn't changed
    }

    // Store the new price as the last known price
    lastPriceForCrypto[symbol] = priceInAud;

    // Save current focus state
    saveFocusDetails();

    users[loggedInUser].cryptos.forEach(async crypto => {
        if (crypto.symbol.toLowerCase() === symbol) {
            const coingeckoId = crypto.id; // Use coingeckoId for DOM element lookup
            const priceElement = document.getElementById(`${coingeckoId}-price-aud`);

            if (priceElement) {
                const previousPrice = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;

                // Update UI elements if the price has changed
                if (priceInAud !== previousPrice) {
                    const triangleElement = document.getElementById(`${coingeckoId}-triangle`);

                    // Determine if price went up or down
                    const isPriceUp = priceInAud > previousPrice;
                    const flashClass = isPriceUp ? 'flash-green' : 'flash-red';
                    const colorClass = isPriceUp ? 'price-up' : 'price-down';

                    // Update price without re-rendering the container
                    priceElement.classList.remove('price-down', 'flash-red', 'price-up', 'flash-green');
                    priceElement.classList.add(colorClass);
                    flashColor(`${coingeckoId}-price-aud`, flashClass); // Flash but remain white afterward
                    triangleElement.classList.toggle('triangle-up', isPriceUp);
                    triangleElement.classList.toggle('triangle-down', !isPriceUp);

                    priceElement.textContent = `$${formatNumber(priceInAud.toFixed(8), true)}`; // Update price
                    const holdings = parseFloat(localStorage.getItem(`${loggedInUser}_${coingeckoId}Holdings`)) || 0;
                    const holdingsValueAud = holdings * priceInAud;

                    // Update holdings value directly
                    const valueElement = document.getElementById(`${coingeckoId}-value-aud`);
                    valueElement.textContent = formatNumber(holdingsValueAud.toFixed(2));

                    // Now update the chart modal holdings and value if it's open
                    if (currentCryptoId === coingeckoId) {
                        const holdingsElement = document.getElementById('holdings-info');
                        holdingsElement.innerHTML = `
                            <p><strong>${holdings.toFixed(3)}</strong> ${crypto.symbol.toUpperCase()} = <strong id="holdings-value">$${holdingsValueAud.toFixed(2)}</strong> AUD</p>
                        `;

                        // Update the live price and holdings amounts in the chart modal with flash and color change
                        const livePriceElement = document.getElementById('live-price');
                        livePriceElement.innerHTML = `
                            <span style="color: white; font-weight: normal;"></span>
                            <b id="live-price-amount" style="color: ${isPriceUp ? '#00FF00' : 'red'};">$${priceInAud.toFixed(8)}</b> 
                            <span style="color: white; font-weight: normal;">AUD</span>
                            (<b id="live-price-usd" style="color: ${isPriceUp ? '#00FF00' : 'red'};">$${priceInUsd.toFixed(8)}</b> <span style="color: white; font-weight: normal;">USD</span>)
                        `;

                        // Flash live price amounts only, not the holdings value in the chart modal
                        flashColor('live-price-amount', flashClass);
                        flashColor('live-price-usd', flashClass);
                        document.getElementById('holdings-value').style.color = isPriceUp ? '#00FF00' : 'red'; // Keep color after the flash for holdings value
                    }

                    updateTotalHoldings(); // Update total holdings on the main page
                    sortContainersByValue(); // Sort based on updated value

                    // Update candlestick chart with the new live price
                    if (currentCryptoId === coingeckoId) {
                        updateCandlestickChart(priceInAud); // Also update live price text
                    }
                }
            }
        }
    });

    // Restore focus state after updates
    restoreFocusDetails();
}



// Flashing function to handle color changes for a specified element
function flashColor(elementId, className) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add(className);
        setTimeout(() => {
            element.classList.remove(className);
        }, 1000); // Flash duration 1 second
    }
}




// Global variable to track API requests in the last minute
let requestCount = 0;
const maxRequestsPerMinute = 60;  // Maximum of 60 requests per minute
const maxRequestsPerSecond = 3;   // Maximum of 3 requests per second

// Function to sleep for a specific time (used to throttle requests)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Updated fetchNewsArticles function with caching, rate-limiting, and right-aligned data
async function fetchNewsArticles(cryptoName, cryptoSymbol) {
    const newsApiKey = '75211ca24268436da2443ab960ce465b'; // Your NewsAPI key
    let totalArticles = 0;
    const cacheKey = `${cryptoName}_newsCache`; // Cache key for each crypto
    const cacheExpiryKey = `${cryptoName}_newsCacheExpiry`; // Cache expiry timestamp key
    const cacheExpiryDuration = 1 * 60 * 1000; // Cache duration (15 minutes)

    // Reset the articles count to 'Loading...' to indicate fetching process
    document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">Loading...</span>`;

    // Get the cached data and its expiry timestamp
    const cachedData = JSON.parse(localStorage.getItem(cacheKey));
    const cacheExpiry = localStorage.getItem(cacheExpiryKey);

    const currentTime = Date.now();

    // Use cached data if it exists and hasn't expired
    if (cachedData && cacheExpiry && currentTime < cacheExpiry) {
        console.log('Using cached data for news.');
        displayNews(cachedData); // Use cached data
        return;
    }

    const newsUrl = `https://newsapi.org/v2/everything?q=${cryptoName}+OR+${cryptoSymbol}&language=en&apiKey=${newsApiKey}`;

    // Throttle the API requests
    if (requestCount >= maxRequestsPerMinute) {
        console.warn('Rate limit reached, waiting...');
        await sleep(60 * 1000);  // Wait for 1 minute before trying again
        requestCount = 0;  // Reset request count after waiting
    }

    try {
        const response = await fetch(newsUrl);
        requestCount++;  // Increment request count after each request

        if (requestCount % maxRequestsPerSecond === 0) {
            // Sleep for 1 second after every 3 requests to avoid hitting per-second limit
            await sleep(1000);
        }

        if (response.status === 429) { // Too many requests (rate-limited)
            console.warn('Rate limit hit, using cached data.');
            if (cachedData) {
                displayNews(cachedData); // Use cached data
            } else {
                console.error('No cached data available.');
                document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">0</span>`;
            }
        } else if (!response.ok) {
            throw new Error('Failed to fetch data');
        } else {
            const newsData = await response.json();
            displayNews(newsData); // Display new data

            // Cache the new data and update the expiry timestamp
            localStorage.setItem(cacheKey, JSON.stringify(newsData));
            localStorage.setItem(cacheExpiryKey, currentTime + cacheExpiryDuration); // Cache for 15 minutes
        }
    } catch (error) {
        console.error('Error fetching from NewsAPI:', error);

        // Use cached data if there's an error fetching new data
        if (cachedData) {
            displayNews(cachedData); // Use cached data
        } else {
            document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">0</span>`;
        }
    }
}

// Function to display news articles and handle right alignment
function displayNews(newsData) {
    const totalArticles = newsData.totalResults || 0;
    document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">${totalArticles}</span>`;
    console.log(`Displaying ${totalArticles} articles`);
}



// Updated fetchRedditMentions function with right-aligned data
async function fetchRedditMentions(cryptoName) {
    const redditUrl = `https://www.reddit.com/r/CryptoCurrency/search.json?q=${cryptoName}&sort=relevance&t=all`;

    // Reset the Reddit mentions count before starting a new fetch
    document.getElementById('xMentions').innerHTML = `<span class="info-data" style="text-align: right; display: block;">Loading...</span>`;

    try {
        const response = await fetch(redditUrl);
        const data = await response.json();
        let mentionsCount = 0;

        // Ensure we filter posts that are actually related to the crypto name
        if (data.data && data.data.children) {
            data.data.children.forEach(post => {
                const postTitle = post.data.title.toLowerCase();
                const postBody = post.data.selftext.toLowerCase();
                const comments = post.data.num_comments || 0; // Count the comments

                // Count posts that include the crypto name in title or body
                if (postTitle.includes(cryptoName.toLowerCase()) || postBody.includes(cryptoName.toLowerCase())) {
                    mentionsCount++;
                    mentionsCount += comments; // Add comments count as mentions
                }
            });
        }

        // Update the Reddit mentions count in the modal with right alignment
        document.getElementById('xMentions').innerHTML = `<span class="info-data" style="text-align: right; display: block;">${mentionsCount}</span>`;
        console.log(`Reddit mentions for ${cryptoName}: ${mentionsCount}`);
    } catch (error) {
        console.error('Error fetching from Reddit:', error);
        document.getElementById('xMentions').innerHTML = `<span class="info-data" style="text-align: right; display: block;">0</span>`; // Default to 0 in case of error
    }
}

// Call both News and Reddit functions
async function fetchNewsAndRedditData(cryptoName, cryptoSymbol) {
    await fetchNewsArticles(cryptoName, cryptoSymbol);
    await fetchRedditMentions(cryptoName);
}




// Function to load data for the specific crypto when the modal is opened
async function loadCryptoDataForModal(coinId) {
    fetchCryptoInfo(coinId);   // Pulls detailed info like market cap, FDV, etc.
    updateSentimentBar(coinId);   // Updates the sentiment bar based on CoinGecko sentiment

    // Fetch and display the number of news articles
    const totalNewsArticles = await fetchNewsArticles(coinId);
    document.getElementById('newsArticles').innerHTML = `<span class="info-data">${totalNewsArticles}</span>`;
}


// Helper function to format large numbers (for both currency and supply amounts)
function formatLargeNumber(value) {
    if (value >= 1e9) { // Billion
        return `${(value / 1e9).toFixed(2)}B`;
    } else if (value >= 1e6) { // Million
        return `${(value / 1e6).toFixed(2)}M`;
    } else if (value >= 1e3) { // Thousand
        return `${(value / 1e3).toFixed(2)}K`;
    } else {
        return value.toFixed(2); // For numbers smaller than 1000
    }
}


// Function to apply right alignment to the data cells
function applyRightAlignment() {
    // Select all second column cells in the crypto-info-table
    const dataCells = document.querySelectorAll('.crypto-info-table td:last-child');
    
    // Loop through each cell and apply the right-aligned style
    dataCells.forEach(cell => {
        cell.style.textAlign = 'right'; // Right-align the text
    });
}

let cryptoInfoInterval = null; // Store the interval ID for refreshing

// Updated fetchCryptoInfo function to include liquidity data and properly right-align table data
async function fetchCryptoInfo(cryptoId) {
    try {
        let success = false;
        let coinData;

        // Try fetching CoinGecko data with API key rotation
        for (let attempt = 0; attempt < apiKeys.length; attempt++) {
            const apiKey = getApiKey();
            const apiUrl = `https://api.coingecko.com/api/v3/coins/${cryptoId}?x_cg_demo_api_key=${apiKey}`;

            try {
                const response = await fetch(apiUrl);
                if (response.status === 429) { // Too many requests, rotate the API key
                    console.warn(`API key ${apiKey} hit rate limit. Switching to next key.`);
                    switchApiKey(); // Rotate to the next key
                    continue; // Retry with the new key
                } else if (!response.ok) {
                    throw new Error('Failed to fetch data');
                }

                coinData = await response.json(); // Success case
                success = true;
                break; // Exit loop if successful
            } catch (error) {
                console.error(`Error with API key ${apiKey}:`, error);
                if (attempt === apiKeys.length - 1) {
                    throw new Error('All API keys failed.');
                }
                switchApiKey(); // Rotate key if failed
            }
        }

        if (!success) throw new Error('Failed to fetch coin data after rotating all API keys.');

        // Log fetched data for debugging
        console.log('CoinGecko info data:', coinData);

        // Check and populate the relevant data if the elements exist
        const marketCapRankElement = document.getElementById('marketCapRank');
        if (marketCapRankElement) {
            marketCapRankElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_cap_rank || 'N/A'}</span>`;
        }

        const fdvElement = document.getElementById('fdv');
        if (fdvElement) {
            fdvElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.fully_diluted_valuation.aud ? formatLargeNumber(coinData.market_data.fully_diluted_valuation.aud) : 'N/A'}</span>`;
        }

        const liquidityElement = document.getElementById('liquidity');
        if (liquidityElement) {
            liquidityElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.total_volume.aud ? formatLargeNumber(coinData.market_data.total_volume.aud) : 'N/A'}</span>`;
        }

        const lowHighElement = document.getElementById('lowHigh');
        if (lowHighElement) {
            lowHighElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">$${coinData.market_data.low_24h.aud} / $${coinData.market_data.high_24h.aud}</span>`;
        }

        const circulatingSupplyElement = document.getElementById('circulatingSupply');
        if (circulatingSupplyElement) {
            circulatingSupplyElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.circulating_supply ? formatLargeNumber(coinData.market_data.circulating_supply) + ` ${coinData.symbol.toUpperCase()}` : 'N/A'}</span>`;
        }

        const totalSupplyElement = document.getElementById('totalSupply');
        if (totalSupplyElement) {
            totalSupplyElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.total_supply ? formatLargeNumber(coinData.market_data.total_supply) + ` ${coinData.symbol.toUpperCase()}` : 'N/A'}</span>`;
        }

        const maxSupplyElement = document.getElementById('maxSupply');
        if (maxSupplyElement) {
            maxSupplyElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.max_supply ? formatLargeNumber(coinData.market_data.max_supply) + ` ${coinData.symbol.toUpperCase()}` : 'N/A'}</span>`;
        }

        const athAtlElement = document.getElementById('athAtl');
        if (athAtlElement) {
            athAtlElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">$${coinData.market_data.ath.aud} / $${coinData.market_data.atl.aud}</span>`;
        }

    } catch (error) {
        console.error('Error fetching detailed crypto info:', error);
    }
}

// Function to start auto-refresh every 30 seconds
function startAutoUpdateCryptoInfo(cryptoId) {
    // Clear any existing interval before starting a new one
    if (cryptoInfoInterval !== null) {
        clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = null;
    }

    // Fetch and update immediately
    fetchCryptoInfo(cryptoId);

    // Set interval to fetch and update every 30 seconds
    cryptoInfoInterval = setInterval(() => {
        if (isModalOpen) {
            fetchCryptoInfo(cryptoId);
        } else {
            clearInterval(cryptoInfoInterval);
            cryptoInfoInterval = null;
        }
    }, 30000);  // 30 seconds = 30000 milliseconds
}


// Function to fetch sentiment data from CoinGecko with API key rotation
async function fetchCryptoSentiment(cryptoId) {
    let success = false;

    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        const apiKey = getApiKey();
        const apiUrl = `https://api.coingecko.com/api/v3/coins/${cryptoId}?x_cg_demo_api_key=${apiKey}`;

        try {
            const response = await fetch(apiUrl);
            if (response.status === 429) { // Rate limit hit
                console.warn(`API key ${apiKey} hit rate limit. Switching to the next key.`);
                switchApiKey();
                continue; // Retry with the next key
            }
            if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

            const data = await response.json();
            const sentimentData = data.sentiment_votes_up_percentage || 50; // Default to 50% if no data
            const bullishPercent = sentimentData;
            const bearishPercent = 100 - bullishPercent;

            // Update the sentiment bar
            document.getElementById('bearish-bar').style.width = `${bearishPercent}%`;
            document.getElementById('bullish-bar').style.width = `${bullishPercent}%`;
            document.getElementById('bearish-label').innerText = `Bearish: ${Math.round(bearishPercent)}%`;
            document.getElementById('bullish-label').innerText = `Bullish: ${Math.round(bullishPercent)}%`;

            console.log(`Sentiment updated: Bullish ${bullishPercent}% | Bearish ${bearishPercent}%`);

            success = true;
            break; // Exit the loop on success
        } catch (error) {
            console.error(`Error fetching sentiment data with API key ${apiKey}:`, error);
            if (attempt === apiKeys.length - 1) {
                console.error('All API keys failed.');
                throw new Error('Unable to fetch sentiment data.');
            }
            switchApiKey(); // Rotate key if failed
        }
    }
}

// Function to update the sentiment bar every minute
async function updateSentimentBar(cryptoId) {
    await fetchCryptoSentiment(cryptoId); // Fetch and display sentiment

    // Update every minute
    setTimeout(() => updateSentimentBar(cryptoId), 30000);
}



// Function to initialize WebSocket with fallback for MEXC and LBank
function initializeWebSocketWithFallback(symbol) {
    // Initialize MEXC WebSocket first
    initializeMexcWebSocket(symbol);

    // Set a timeout to switch to LBank WebSocket if MEXC WebSocket fails
    setTimeout(() => {
        if (!isMexcWebSocketOpen) {
            console.log(`MEXC WebSocket failed. Switching to LBank WebSocket for ${symbol}`);
            initializeLBankWebSocket(symbol);
        }
    }, 5000); // 5 seconds delay before switching to LBank
}

// Function to initialize MEXC WebSocket for live prices
function initializeMexcWebSocket(symbol) {
    const wsEndpoint = 'wss://wbs.mexc.com/ws';
    const socket = new WebSocket(wsEndpoint);

    socket.onopen = function () {
        console.log(`MEXC WebSocket connection opened for ${symbol}`);
        isMexcWebSocketOpen = true;

        // Subscribe to the specific symbol on MEXC WebSocket
        const subscriptionMessage = JSON.stringify({
            "method": "SUBSCRIPTION",
            "params": [`spot@public.deals.v3.api@${symbol.toUpperCase()}USDT`],
            "id": 1
        });
        socket.send(subscriptionMessage);
    };

    socket.onmessage = function (event) {
        const message = JSON.parse(event.data);
        if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
            const deals = message.d.deals;
            const firstDeal = deals[0];
            if (firstDeal && firstDeal.p !== undefined) {
                const price = parseFloat(firstDeal.p);
                console.log(`MEXC live price for ${symbol}: ${price} USDT`);
                updatePriceInChart(symbol, price); // Update chart with live price
            }
        }
    };

    socket.onclose = function () {
        console.log(`MEXC WebSocket connection closed for ${symbol}`);
        isMexcWebSocketOpen = false;
    };

    socket.onerror = function (error) {
        console.error(`MEXC WebSocket error:`, error);
        isMexcWebSocketOpen = false;
    };
}



let updateTimeout;

function debounceUpdateUI(cryptoId, priceInAud) {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(() => {
        const priceElement = document.getElementById(`${cryptoId}-price-aud`);
        if (priceElement) {
            const holdings = parseFloat(localStorage.getItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
            document.getElementById(`${cryptoId}-value-aud`).textContent = formatNumber((holdings * priceInAud).toFixed(2));
        }

        updateTotalHoldings();
        sortContainersByValue();
    }, 500);  // Debounce to update after 500ms
}





// Function to update the candlestick chart with live USD price and convert it to AUD
function updatePriceInChart(priceInUsd) {
    const conversionRate = 1.52; // Example conversion rate from USD to AUD
    const priceInAud = priceInUsd * conversionRate;

    if (candlestickChart) {
        const now = new Date();
        const lastCandle = candlestickChart.data.datasets[0].data[candlestickChart.data.datasets[0].data.length - 1];

        if (lastCandle && now - new Date(lastCandle.x) < 5 * 60 * 1000) {
            lastCandle.c = priceInAud;
            if (priceInAud > lastCandle.h) lastCandle.h = priceInAud;
            if (priceInAud < lastCandle.l) lastCandle.l = priceInAud;
            console.log(`Updated existing candle at ${lastCandle.x} with price: AUD $${priceInAud}`);
        } else {
            candlestickChart.data.datasets[0].data.push({
                x: now,
                o: priceInAud,
                h: priceInAud,
                l: priceInAud,
                c: priceInAud
            });
            console.log(`Created new candle at ${now} with price: AUD $${priceInAud}`);
        }

        // Update the chart
        candlestickChart.update();

        // Update live price in the modal header (show both AUD and USD)
        const livePriceElement = document.getElementById('live-price');
        if (livePriceElement) {
            livePriceElement.innerHTML = `<span style="font-weight: normal;"></span><b>$${priceInAud.toFixed(8)}</b> <span style="font-weight: normal;">AUD</span> (<b>$${priceInUsd.toFixed(8)}</b> <span style="font-weight: normal;">USD</span>)`;
            // Update live price
        }
    }
}





async function checkWebSocketUpdate() {
    const now = Date.now();

    // Loop through all cryptos
    for (let crypto of users[loggedInUser].cryptos) {
        const symbol = crypto.symbol.toLowerCase();

        // Check if no WebSocket update for over 2 minutes
        if (!lastWebSocketUpdateForCrypto[symbol] || now - lastWebSocketUpdateForCrypto[symbol] > twoMinutes) {
            console.log(`No WebSocket update for ${symbol} in 2 minutes. Fetching from CoinGecko...`);

            // Fallback to CoinGecko for this coin
            const geckoPrice = await fetchPricesFromCoinGecko(crypto.id);
            const priceElement = document.getElementById(`${crypto.id}-price-aud`);

            if (geckoPrice !== null) {
                // Update price from CoinGecko
                const priceInAud = geckoPrice;
                const previousPrice = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;

                if (priceInAud !== previousPrice) {
                    priceElement.textContent = `$${formatNumber(priceInAud.toFixed(8), true)}`;
                    updateCryptoValue(crypto.id);
                    updateTotalHoldings();
                    console.log(`Fetched CoinGecko price for ${crypto.symbol}: $${priceInAud} AUD`);
                }
            } else {
                console.error(`Failed to get CoinGecko price for ${crypto.symbol}`);
            }
        }
    }
}



let lastApiCall = 0;
const apiCooldown = 60000; // 1 minute cooldown

function canFetchFromApi() {
    const now = Date.now();
    if (now - lastApiCall > apiCooldown) {
        lastApiCall = now;
        return true;
    }
    return false;
}


let priceCache = {};
const cacheExpiryTime = 60000; // Cache for 1 minute

async function fetchWithCache(cryptoId) {
    const now = Date.now();
    if (priceCache[cryptoId] && (now - priceCache[cryptoId].timestamp < cacheExpiryTime)) {
        return priceCache[cryptoId].price;
    }

    if (canFetchFromApi()) {
        const price = await fetchPricesFromCoinGecko(cryptoId);
        if (price) {
            priceCache[cryptoId] = { price, timestamp: now };
        }
        return price;
    } else {
        console.log('API request throttled.');
        return null;
    }
}






// Function to update the candlestick chart with live price data in AUD and USD
function updateCandlestickChart(priceInAud, priceInUsd) {
    if (!candlestickChart || !candlestickChart.data || !candlestickChart.data.datasets || candlestickChart.data.datasets.length === 0) {
        console.error('Candlestick chart not initialized or data is missing.');
        return;
    }

    const now = new Date();
    const lastCandle = candlestickChart.data.datasets[0].data[candlestickChart.data.datasets[0].data.length - 1];

    // Check if the current time is within the same 5-minute interval
    if (lastCandle && now - new Date(lastCandle.x) < 5 * 60 * 1000) { 
        // If within 5 minutes, update the last candle
        lastCandle.c = priceInAud;
        if (priceInAud > lastCandle.h) lastCandle.h = priceInAud;
        if (priceInAud < lastCandle.l) lastCandle.l = priceInAud;
        console.log(`Updated existing candle at ${lastCandle.x} with price: AUD $${priceInAud}`);
    } else { 
        // Otherwise, create a new candle
        candlestickChart.data.datasets[0].data.push({
            x: now,
            o: priceInAud,
            h: priceInAud,
            l: priceInAud,
            c: priceInAud
        });
        console.log(`Created new candle at ${now} with price: AUD $${priceInAud}`);
    }

    // Adjust the chart's x-axis time range to zoom out slightly and leave room on the right
    const paddingTime = 10 * 60 * 1000; // Add 10 minutes of padding to the right
    candlestickChart.options.scales.x.min = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6 hours ago
    candlestickChart.options.scales.x.max = new Date(now.getTime() + paddingTime); // Add extra space to the right for padding

    candlestickChart.update(); // Update the chart to reflect the new data

    // Update live price in the modal header (show both AUD and USD)
    const livePriceElement = document.getElementById('live-price');
    if (livePriceElement) {
        livePriceElement.innerHTML = `<span style="font-weight: normal;">Live Price: </span><b>$${priceInAud.toFixed(8)}</b> <span style="font-weight: normal;">AUD</span> (<b>$${priceInUsd.toFixed(8)}</b> <span style="font-weight: normal;">USD</span>)`;
        // Update live price
    }
}



function saveCandlestickData(cryptoId, priceInAud) {
    const now = new Date();
    const candlestickData = JSON.parse(localStorage.getItem(`${cryptoId}_candlestickData`)) || [];

    const lastCandle = candlestickData[candlestickData.length - 1];
    if (lastCandle && now - new Date(lastCandle.x) < 5 * 60 * 1000) {
        lastCandle.c = priceInAud;
        if (priceInAud > lastCandle.h) lastCandle.h = priceInAud;
        if (priceInAud < lastCandle.l) lastCandle.l = priceInAud;
    } else {
        candlestickData.push({
            x: now,
            o: priceInAud,
            h: priceInAud,
            l: priceInAud,
            c: priceInAud
        });
    }

    localStorage.setItem(`${cryptoId}_candlestickData`, JSON.stringify(candlestickData));
}

async function fetchHistoricalData(cryptoId) {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=1`);
    if (!response.ok) {
        throw new Error('Failed to fetch historical data');
    }
    const data = await response.json();
    const conversionRate = 1.51; // Example conversion rate from USD to AUD

    return data.map(d => ({
        x: new Date(d[0]),
        o: d[1] * conversionRate,
        h: d[2] * conversionRate,
        l: d[3] * conversionRate,
        c: d[4] * conversionRate
    }));
}

function initializeWebSocketForCrypto(symbol) {
    const wsEndpoint = 'wss://wbs.mexc.com/ws'; // Example MEXC WebSocket
    currentWebSocket = new WebSocket(wsEndpoint); // Track the WebSocket for the current modal

    currentWebSocket.onopen = function() {
        console.log(`WebSocket connection opened for ${symbol}`);

        // Subscribe to the specific symbol
        const subscriptionMessage = JSON.stringify({
            "method": "SUBSCRIPTION",
            "params": [`spot@public.deals.v3.api@${symbol.toUpperCase()}USDT`],
            "id": 1
        });
        currentWebSocket.send(subscriptionMessage);
    };

    currentWebSocket.onmessage = function(event) {
        const message = JSON.parse(event.data);
        if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
            const deals = message.d.deals;
            const firstDeal = deals[0];
            if (firstDeal && firstDeal.p !== undefined) {
                const price = parseFloat(firstDeal.p);
                console.log(`Live price for ${symbol}: ${price} USDT`);
                
                // Update the price only if the current modal is open and matches the symbol
                if (isModalOpen && currentModalCryptoSymbol === symbol) {
                    updatePriceInChart(price); // Update the candlestick chart with live price
                }
            }
        }
    };

    currentWebSocket.onclose = function() {
        console.log(`WebSocket connection closed for ${symbol}`);
    };

    currentWebSocket.onerror = function(error) {
        console.error(`WebSocket error for ${symbol}:`, error);
    };
}

let isSpacebarPressed = false;

// Listen for keydown and keyup events to detect spacebar press
document.addEventListener('keydown', function (event) {
    if (event.code === 'Space') {
        isSpacebarPressed = true;
        document.body.style.cursor = 'grab';  // Change cursor to indicate panning mode
    }
});

document.addEventListener('keyup', function (event) {
    if (event.code === 'Space') {
        isSpacebarPressed = false;
        document.body.style.cursor = 'default';  // Reset cursor
    }
});

let currentModalCryptoSymbol = null; // Store the current symbol for the modal
let currentWebSocket = null; // Track the current WebSocket connection for the modal
let isModalOpen = false; // Track if modal is open



// Function to open the candlestick modal and load data for the specific crypto
async function openCandlestickModal(cryptoId) {
    currentCryptoId = cryptoId;
    isModalOpen = true;

    if (currentWebSocket) {
        currentWebSocket.close();
        currentWebSocket = null;
    }

    if (cryptoInfoInterval !== null) {
        clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = null;
    }

    const modal = document.getElementById('candlestick-modal');
    const ctx = document.getElementById('candlestick-chart').getContext('2d');

    try {
        // Fetch the cryptocurrency from user data
        const crypto = users[loggedInUser].cryptos.find(crypto => crypto.id === cryptoId);
        if (!crypto) {
            throw new Error('Cryptocurrency not found for the provided ID.');
        }

        const symbol = crypto.symbol.toLowerCase();
        const cryptoName = crypto.name; // Pull crypto name dynamically for news/reddit
        currentModalCryptoSymbol = symbol;

        // Update the crypto icon and name
        const cryptoIconElement = document.getElementById('crypto-icon');
        const cryptoNameElement = document.getElementById('crypto-name');

        let coinData;
        let success = false;

        // Try fetching CoinGecko data with API key rotation
        for (let attempt = 0; attempt < apiKeys.length; attempt++) {
            const apiKey = getApiKey();
            const coinGeckoApi = `https://api.coingecko.com/api/v3/coins/${cryptoId}?x_cg_demo_api_key=${apiKey}`;
            try {
                const response = await fetch(coinGeckoApi);
                if (response.status === 429) { // Too many requests, rotate the API key
                    console.warn(`API key ${apiKey} hit rate limit. Switching to the next key.`);
                    switchApiKey(); // Rotate to the next key
                    continue; // Retry with the new key
                } else if (!response.ok) {
                    throw new Error('Failed to fetch data');
                }
                coinData = await response.json(); // Success case
                success = true;
                break;
            } catch (error) {
                console.error('Error fetching data:', error);
                if (attempt === apiKeys.length - 1) {
                    throw new Error('All API keys failed.');
                }
                switchApiKey(); // Rotate key if failed
            }
        }

        if (!success) throw new Error('Failed to fetch coin data after rotating all API keys.');

        // Update icon and name in the modal
        cryptoIconElement.src = coinData.image.small;
        cryptoIconElement.alt = `${crypto.name} Icon`;
        cryptoNameElement.textContent = `${crypto.name} (${crypto.symbol.toUpperCase()})`;

        // Display holdings and holdings value
        const holdings = parseFloat(getStorageItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
        const priceInAud = parseFloat(document.getElementById(`${cryptoId}-price-aud`).textContent.replace(/,/g, '').replace('$', '')) || 0;
        const holdingsValueAud = holdings * priceInAud;
        const holdingsElement = document.getElementById('holdings-info');
        holdingsElement.innerHTML = `
            <p><strong>${holdings.toFixed(3)}</strong> ${crypto.symbol.toUpperCase()} = <strong>$${holdingsValueAud.toFixed(2)}</strong> AUD</p>
        `;

        // Fetch historical data and render the chart
        const historicalData = await fetchHistoricalData(cryptoId);
        const savedData = JSON.parse(localStorage.getItem(`${cryptoId}_candlestickData`)) || [];
        const combinedData = [...historicalData, ...savedData];

        const chartData = formatCandlestickData(combinedData);
        document.getElementById('live-price').textContent = `Waiting for Live Price...`;

        if (candlestickChart) {
            candlestickChart.destroy();
        }

        // Get current date and 24 hours ago for x-axis limits
        const now = new Date();
        const past24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));

        candlestickChart = new Chart(ctx, {
            type: 'candlestick',
            data: chartData,
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'minute',
                            stepSize: 5,
                            displayFormats: {
                                minute: 'HH:mm'
                            },
                            minUnit: 'minute'
                        },
                        ticks: {
                            source: 'auto',
                            autoSkip: true,
                            maxRotation: 0,
                            major: {
                                enabled: true
                            }
                        },
                        grid: {
                            color: 'rgba(211,211,211,0.2)',
                            drawBorder: false
                        },
                        min: past24Hours, // Set minimum to 24 hours ago
                        max: now // Set maximum to current time
                    },
                    y: {
                        beginAtZero: false,
                        grid: {
                            color: 'rgba(211,211,211,0.2)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: function(value) {
                                return `$${value.toFixed(8)}`;
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        position: 'nearest',
                        callbacks: {
                            label: function(context) {
                                let h = context.raw.h.toFixed(8);
                                let l = context.raw.l.toFixed(8);
                                return `H: $${h}, L: $${l}`;
                            },
                            title: function(context) {
                                const date = new Date(context[0].parsed.x);
                                return date.toLocaleString();
                            }
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x',
                            onPan: function({ chart }) {
                                chart.update('none');
                            }
                        },
                        zoom: {
                            wheel: {
                                enabled: true,
                                modifierKey: null
                            },
                            pinch: {
                                enabled: true
                            },
                            mode: 'x',
                            onZoom: function({ chart }) {
                                chart.update('none');
                            }
                        }
                    }
                },
                elements: {
                    candlestick: {
                        borderColor: '#26a69a',
                        borderWidth: 1,
                        barThickness: 5
                    }
                }
            }
        });

        modal.style.display = 'block';

        // Fetch and display detailed info and sentiment data
        await fetchCryptoInfo(cryptoId);  // Market data
        await fetchCryptoSentiment(cryptoId);  // Sentiment data
        await fetchNewsAndRedditData(cryptoName);  // Fetch news and Reddit mentions using crypto name
        
        startAutoUpdateCryptoInfo(cryptoId);
        
        // Initialize WebSocket for live price updates
        initializeWebSocketForCrypto(symbol);

        // Start refreshing the data every 30 seconds, but stop when modal is closed
        if (cryptoInfoInterval) clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = setInterval(async () => {
            if (isModalOpen && currentCryptoId === cryptoId) {
                await fetchCryptoInfo(cryptoId);
                await fetchCryptoSentiment(cryptoId);
                await fetchNewsAndRedditData(cryptoName); 
            }
        }, 30000); // 30 seconds

    } catch (error) {
        console.error('Error fetching or displaying candlestick data:', error);
    }
}




// New function to fetch and display live price with USD
async function fetchLivePrice(symbol) {
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=aud,usd`; // Fetch both AUD and USD prices
    
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        // Retrieve both live prices for AUD and USD
        const audPrice = data[symbol].aud;  
        const usdPrice = data[symbol].usd;

        // Update the modal with the live price in AUD and the USD equivalent in brackets
        document.getElementById('live-price').textContent = `$${audPrice.toFixed(2)} (USD: $${usdPrice.toFixed(2)})`;
        
    } catch (error) {
        console.error('Error fetching live price:', error);
    }
}




function closeCandlestickModal() {
    isModalOpen = false; // Mark that the modal is closed
    currentModalCryptoSymbol = null; // Reset the current modal crypto symbol

    // Close the WebSocket if it's open
    if (currentWebSocket) {
        currentWebSocket.close();
        currentWebSocket = null; // Reset the WebSocket
    }

    // Close the modal display
    document.getElementById('candlestick-modal').style.display = 'none';

    // Clear the interval when the modal is closed
    if (cryptoInfoInterval !== null) {
        clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = null;
    }
}








async function fetchCandlestickData(cryptoId) {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=1`);
    if (!response.ok) {
        throw new Error('Failed to fetch candlestick data');
    }
    return await response.json();
}

function formatCandlestickData(data) {
    return {
        datasets: [{
            label: 'Candlestick Chart',
            data: data.map(d => ({
                x: new Date(d.x),
                o: d.o,
                h: d.h,
                l: d.l,
                c: d.c
            })),
            borderColor: '#26a69a',
            backgroundColor: 'rgba(38, 166, 154, 0.5)',
            borderWidth: 1,
            barThickness: 5 // Thinner candlesticks
        }]
    };
}

function closeCandlestickModal() {
    currentCryptoId = null;
    closeWebSocket();
    document.getElementById('candlestick-modal').style.display = 'none';
    const tooltipEl = document.getElementById('chartjs-tooltip');
    if (tooltipEl) {
        tooltipEl.style.opacity = 0;
    }
    initializeWebSocket(); // Reinitialize WebSocket for all cryptos
}

 

// Initialize the app
initializeApp();




           

