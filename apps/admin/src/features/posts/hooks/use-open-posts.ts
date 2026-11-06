// "View in My Posts" after a publish (F50) and the way back after an edit (T3.9): Home's stack becomes Home → My Posts,
// so the phone's back button returns to Home.
import { useNavigator } from '@mc/ui/navigation';
import { useCallback } from 'react';

/** Opens My Posts on top of Home (the flow's screens are popped). */
export function useOpenPosts(): () => void {
  const navigator = useNavigator();
  return useCallback(() => {
    navigator.selectTab('home');
    navigator.push('/posts');
  }, [navigator]);
}
