import { useState } from 'react'
import MediaRoom from './MediaRoom'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';


function App() {
  const [count, setCount] = useState(0)

  return (
    <BrowserRouter>
      <Routes>
        
        <Route path="/sfu/room" element={<MediaRoom />} />

      </Routes>

    </BrowserRouter>
   
  )
}

export default App
