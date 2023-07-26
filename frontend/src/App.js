import heart from './HUMAN_HEART-cropped.svg';
import { TODAYS_IMAGE_ENDPOINT, TODAYS_METADATA_ENDPOINT } from './config/api';
import './App.css';

import axios from 'axios';
import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from 'react-query';
import Selector from './components/Reactions/Selector';
import ReactionCounts from './components/Reactions/ReactionCounts';
import DailyImage from './components/DailyImage/Image';
import Swiper from './components/Swiper/Swiper';

import _ from 'lodash';
import { register } from 'swiper/element/bundle';
import { hasReacted } from './components/Reactions/utils';
import { NO_REACTION } from './config/constants';

register();
const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient} >
      <Page />
    </QueryClientProvider>
  )
}

function Page() {
  // Fetch the current image
  const todaysImageResponse = useQuery({
    queryKey: ['imageUrl'],
    queryFn: () =>
      axios.get(TODAYS_IMAGE_ENDPOINT)
        .then((res) => res.data)
  });

  // Fetch todays metadata
  const todaysMetadataResponse = useQuery({
    queryKey: ['metadata'],
    retry: false,
    queryFn: () =>
      axios.get(TODAYS_METADATA_ENDPOINT, { 
        params : { 
          uuid: localStorage.getItem('uuid') 
        } 
      }).then((res) => res.data)
  });

  return <SubPage 
          todaysImageResponse={todaysImageResponse}
          todaysMetadataResponse={todaysMetadataResponse} />
}

const SubPage = ({ todaysImageResponse, todaysMetadataResponse }) => {
  const [todaysImage, setTodaysImage] = useState(null);

  const [currUuid, setCurrUuid] = useState(null);
  const [currReaction, setCurrReaction] = useState(NO_REACTION);
  const [currReactionCounts, setCurrReactionCounts] = useState(null);

  const [weeklyRecap, setWeeklyRecap] = useState(null);
  const [currFavoriteUrl, setCurrFavoriteUrl] = useState('');
  const [showSlider, setShowSlider] = useState(false);

  // Set the current image and potential set of weekly recap images
  useEffect(() => {
    if (todaysImageResponse.isSuccess) {
      setTodaysImage(todaysImageResponse.data.url);
    }
  }, [todaysImageResponse]);

  useEffect(() => {
    if (todaysImageResponse.isSuccess && todaysImageResponse.data.weekly_recap != null) {
      setWeeklyRecap(todaysImageResponse.data.weekly_recap);
    }
  }, [todaysImageResponse]);

  // Set state and localStorage based on todays metadata
  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrReaction(todaysMetadataResponse.data.reaction);
    
      const currUuid = localStorage.getItem('uuid')

      if (currUuid === null) {
        localStorage.setItem('uuid', todaysMetadataResponse.data.uuid);
        setCurrUuid(todaysMetadataResponse.data.uuid);
      } else {
        setCurrUuid(currUuid);
      }
    }
  }, [todaysMetadataResponse]);

  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrReactionCounts(todaysMetadataResponse.data.counts);
    }
  }, [todaysMetadataResponse]);

  // On emoji press, update the reaction
  const onEmojiClick = (uuid) => (reaction) => {
    const reactionToSend = reaction === currReaction ? NO_REACTION : reaction; 

    axios.put(TODAYS_METADATA_ENDPOINT, {'reaction': reactionToSend, 'uuid': uuid})
    .then(res => {
      // Means the put was successful
      setCurrReaction(reactionToSend)
      setCurrReactionCounts(res.data.counts)
    })
  }

  // On recap image press, update the favorite URL 
  const onRecapClick = (uuid) => (url) => {
    setCurrFavoriteUrl(url);
  }

  const shakeHeart = (currReaction, showSlider) => hasReacted(currReaction) && !showSlider;

  return (
    <div className='min-w-screen min-h-screen text-white bg-black'>
      <div className='flex justify-between items-center w-screen font-serif p-1 text-4xl'> 
        <p>
          ForMaeov
        </p>
        <img 
          src={heart} 
          className={ shakeHeart(currReaction, showSlider)
              ? 'animate-shake text-left h-20 w-20'
              : 'text-left bg-black h-20 w-20'
          } 
          onClick={() => hasReacted(currReaction) 
                          ? setShowSlider(!showSlider)
                          : null }
          alt="Human heart" />
      </div>
      <AppBody 
            todaysImageLoading={todaysImageResponse.isLoading}
            todaysMetadataLoading={todaysMetadataResponse.isLoading}
            imageUrl={todaysImage} 
            weeklyRecap={weeklyRecap}
            currReaction={currReaction}
            currReactionCounts={currReactionCounts}
            currUuid={currUuid}
            currFavoriteUrl={currFavoriteUrl}
            onEmojiClick={onEmojiClick(currUuid)}
            onRecapClick={onRecapClick(currUuid)}
            showSlider={showSlider}/>
    </div>
  );
}

const AppBody = ({
  todaysImageLoading, 
  todaysMetadataLoading, 
  imageUrl, 
  weeklyRecap, 
  currReaction, 
  currReactionCounts, 
  currUuid, 
  currFavoriteUrl, 
  onEmojiClick, 
  onRecapClick, 
  showSlider
}) => (
  <div>
      {
        todaysImageLoading || todaysMetadataLoading
          ? <Loading /> 
          : <Content
              showSlider={showSlider}
              weeklyRecap={weeklyRecap}
              currFavoriteUrl={currFavoriteUrl}
              onRecapClick={onRecapClick}
              imageUrl={imageUrl}
              currReaction={currReaction}
              currReactionCounts={currReactionCounts}
              onEmojiClick={onEmojiClick} />
      }
  </div>
);

const Content = ({showSlider, weeklyRecap, currFavoriteUrl, onRecapClick, imageUrl, currReaction, currReactionCounts, onEmojiClick}) => {
  return showSlider
    ? <Swiper 
        weeklyRecap={weeklyRecap}
        currFavoriteUrl={currFavoriteUrl}
        onRecapClick={onRecapClick}
        />
    : <Image 
        imageUrl={imageUrl}
        weeklyRecap={weeklyRecap}
        currReaction={currReaction}
        currReactionCounts={currReactionCounts}
        onEmojiClick={onEmojiClick} />
}

const Image = ({imageUrl, currReaction, currReactionCounts, onEmojiClick}) => {
  return <div>
    <DailyImage url={imageUrl} alt={"todays pic"} />
    <ReactionCounts currReactionCounts={currReactionCounts} />
    <Selector currReaction={currReaction} onSelect={onEmojiClick} />
  </div>
}

const Loading = ({props}) => {
  return <div className='text-center'>
      <div className="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
    </div>
}