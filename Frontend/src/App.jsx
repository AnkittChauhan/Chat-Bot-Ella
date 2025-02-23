import React from 'react'
import TalkToElla from './TalkToElla'
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Navbar from './Components/Navbar';

const App = () => {
  return (
   <>
     
      
      <BrowserRouter>
      < Navbar /> 
      <Routes>
        <Route path="/" element={< TalkToElla />} />
      </Routes>
    </BrowserRouter>
   </>
  )
}

export default App