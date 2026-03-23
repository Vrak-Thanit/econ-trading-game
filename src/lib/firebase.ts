import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCcBAfI4NzccsCsiLveEAP6qDq5ER4i1uU",
  authDomain: "econ-trading-game.firebaseapp.com",
  projectId: "econ-trading-game",
  storageBucket: "econ-trading-game.firebasestorage.app",
  messagingSenderId: "830601981590",
  appId: "1:830601981590:web:5a9fd9d18f98f5660edcb7",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
