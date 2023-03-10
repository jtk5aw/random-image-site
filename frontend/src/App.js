import heart from './HUMAN_HEART.svg';
import { TODAYS_IMAGE_ENDPOINT } from './config/api';
import './App.css';

import axios from 'axios';
import React, { useState, useEffect } from 'react';
import Selector from './components/Selector/Selector';


function App() {
  const [base64ImageString, setBase64ImageString] = useState('');
  const [showImage, setShowImage] = useState(false);

  useEffect(() => {
    axios.get(TODAYS_IMAGE_ENDPOINT)
    .then(res => {
        const returnedString = res.data;
        setBase64ImageString(returnedString);
      })
  }, [])

  const onClick = () => setShowImage(true);

  return (
    <div className="App">
      <div className="Title-Header" onClick={onClick}> 
        <img src={heart} className="Header-Image" alt="Human heart" />
        <p>
          Click only if you're Maeov. No one else click 😡
        </p>
      </div>
      { showImage ? <AppBody props={{ 'imageString': base64ImageString }} /> : null }
    </div>
  );
}

const AppBody = ({props}) => (
  <div className="App-Body">
      {
        props.imageString === '' ? <Loading /> : <Successful props={{ 'imageString': props.imageString }} />
      }
  </div>
);

const Successful = ({props}) => {
  return <div>
    <img src={`data:image/jpg;base64,${props.imageString}`} className="Todays-Image" alt="todays pic" />
    <Selector />
    <p className="Todays-Text">
      Here is todays specially selected image 😎
      I hope you like this one and I hope you come back tomorrow for another one. 
    </p>
  </div>
}

const Loading = ({props}) => {
  return <div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
}

export default App;
