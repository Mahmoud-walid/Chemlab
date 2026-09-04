import React from "react";
import { FiAlertTriangle } from "react-icons/fi";

export default function ExperiementsPage() {
  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-screen text-center px-4">
        <FiAlertTriangle className="text-yellow-500 w-16 h-16 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Page Under Development</h1>
        <p className="text-gray-600">
          Sorry! This section of Chemlab is still being cooked. Check back soon
          for more chemistry fun.
        </p>
      </div>
    </>
  );
}
