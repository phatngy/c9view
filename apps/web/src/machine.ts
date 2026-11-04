import { createContext, useContext } from 'react';

export const MachineContext = createContext('local');
export const useMachineId = () => useContext(MachineContext);
