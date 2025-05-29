import { MdKeyboardArrowLeft } from 'react-icons/md';

import { DailyImage } from '../DailyImage/Image';
import _ from 'lodash';

export const Swiper = ({weeklyRecap, currFavoriteUrl, onRecapClick, onToggleRecentImagesClick}) => {
  return <div> 
    <swiper-container className='h-10'>
    <StartingSlot currFavoriteUrl={currFavoriteUrl} onToggleRecentImagesClick={onToggleRecentImagesClick} />
      { 
        _.map(weeklyRecap, (url, index) => {
          return <SwiperSlide url={url} index={index} onRecapClick={onRecapClick} />
        })
      }
    </swiper-container>
  </div>
}

const StartingSlot = ({currFavoriteUrl, onToggleRecentImagesClick}) => {
  return <div slot="container-start" className='flex flex-row justify-between'>
    <MdKeyboardArrowLeft size={40} onClick={onToggleRecentImagesClick}/>
    {
    currFavoriteUrl === '' 
    ? null 
    : <div className='flex flex-col'> 
        <p className='font-serif'> New Favorite! </p>
        <DailyImage 
        url={currFavoriteUrl} 
        className={'object-scale-down max-w-sm max-h-24 p-2'}
        alt='Currently selected favorite image'/>
      </div>
      
    }
    <div> </div>
  </div>
}

const SwiperSlide = ({url, index, onRecapClick}) => {
  return <swiper-slide key={url}> 
    <DailyImage 
      url={url} 
      alt={`This is the ${index} in the carousel. Will add better alt text later`} 
      onClick={onRecapClick} />
  </swiper-slide>
}

export default Swiper;