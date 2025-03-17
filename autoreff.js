const axios = require('axios');
const { ethers } = require('ethers');
const fs = require('fs');
const faker = require('@faker-js/faker').faker;
const randomUser Agent = require('random-useragent');

function generateRandomReferral() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateWallet() {
    const wallet = ethers.Wallet.createRandom();
    return { address: wallet.address, privateKey: wallet.privateKey };
}

function generateRandomEmail() {
    const firstName = faker.person.firstName().toLowerCase();
    const lastName = faker.person.lastName().toLowerCase();
    const number = Math.floor(1000 + Math.random() * 9000);
    return `${firstName}${lastName}${number}@gmail.com`;
}

async function checkWalletExists(walletAddress) {
    const url = `https://dashboard.ispolink.com/admin/api/v1/user/checkifexists/${walletAddress}`;
    try {
        const response = await axios.get(url);
        //console.log("Wallet Existence Response:", response.data);
        return response.data;
    } catch (error) {
        console.error("Error checking wallet existence:", error.response?.data || error.message);
    }
}

async function updateProfile(userId, apiKey, walletAddress, email) {
    if (!email) {
        console.error("Skipping profile update due to missing email");
        return;
    }

    const url = "https://dashboard.ispolink.com/admin/api/v1/profile/update";
    const formData = new URLSearchParams();
    
    formData.append("userid", userId);
    formData.append("apikey", apiKey);
    formData.append("walletaddress", walletAddress);
    formData.append("profile_image", "false");
    formData.append("username", faker.person.fullName());
    formData.append("email", email);

    try {
        const response = await axios.post(url, formData, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        //console.log("Successfully updated profile", response.data);
        console.log("Successfully updated profile");
    } catch (error) {
        console.error("Error updating profile:", error.response?.data || error.message);
    }
}

async function registerWallet(referralCode) {
    const myOwnReferral = generateRandomReferral();
    const { address, privateKey } = generateWallet();
    const email = generateRandomEmail();
    const userAgent = randomUser Agent.getRandom();

    console.log(`Starting registration for: ${email}`);

    const url = "https://dashboard.ispolink.com/admin/api/v1/user/registerwallet";
    const headers = {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "origin": "https://dashboard.ispolink.com",
        "referer": `https://dashboard.ispolink.com/?referral=${referralCode}`,
        "user-agent": userAgent
    };

    const data = {
        referralcode: referralCode,
        myownreferralcode: myOwnReferral,
        walletaddress: address
    };

    try {
        const response = await axios.post(url, data, { headers });
        //console.log("Successfully registered wallet", response.data);
        console.log("Successfully registered wallet");

        if (response.status === 200) {
            console.log("Wallet registered successfully!");
            console.log("Referral Code:", myOwnReferral);
            console.log("Wallet Address:", address);
            console.log("Private Key:", privateKey);
            console.log("Email:", email);

            // Save account to file
            const accountInfo = `Email: ${email} | Wallet: ${address} | PrivateKey: ${privateKey} | Referral: ${myOwnReferral}\n`;
            fs.appendFileSync('accounts.txt', accountInfo, 'utf8');

            // Check wallet in the system
            const walletData = await checkWalletExists(address);
            if (walletData && walletData.success) {
                await updateProfile(walletData.userid, walletData.apikey, address, email);
            }
        }
    } catch (error) {
        console.error("Error registering wallet:", error.response?.data || error.message);
    }
}

// Run 10 times
async function runRegistrations(times) {
    for (let i = 1; i <= times; i++) {
        console.log(`\n=== Starting registration ${i} ===`);
        await registerWallet("SANSUT");
    }
}

runRegistrations(100000000000000);
