"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ContactModal from "../components/ContactModal";

export default function ContactPage() {
  const [isOpen, setIsOpen] = useState(true);
  const router = useRouter();

  const handleClose = () => {
    setIsOpen(false);
    router.push("/");
  };

  return (
    <div style={{ 
      minHeight: "100vh", 
      background: "#f5f5f5",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }}>
      <ContactModal isOpen={isOpen} onClose={handleClose} />
    </div>
  );
}
