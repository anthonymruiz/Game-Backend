import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('preferences')
export class Preferences {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ default: 'en' })
  language!: string;

  @Column({ default: 'light' })
  theme!: string;
}
